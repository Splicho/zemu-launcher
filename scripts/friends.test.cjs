const assert = require('node:assert/strict')
// Values that cross the `runInNewContext` boundary carry the VM
// realm's prototypes, so strict deep equality rejects them on
// identity alone. `structural` compares shape and primitives only.
const structural = require('node:assert').deepEqual
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

// This suite pins the transport contract of the game API client:
// on desktop every request leaves through the Rust `http_fetch`
// command, never the WebView's `fetch`. Going through the WebView
// is what the CORS fix removed, and it fails silently (the request
// is rejected by the browser, not the server), so it needs a test
// that fails loudly instead.
//
// Wire-shape coverage for the friends graph itself lives with the
// game server contract, not here — `gameFetch` is deliberately
// shape-agnostic and forwards whatever JSON it is handed.

function transpile(path) {
  const source = readFileSync(require.resolve(path), 'utf8')
  return ts.transpileModule(source.replaceAll('import.meta.env', 'testEnv'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
}

const gameApiSource = transpile('../src/lib/zemu-game-api.ts')

function setup(desktop, { respond, failure, authKey = 'test-auth-key' } = {}) {
  const calls = []
  const exports = {}
  async function request(call) {
    calls.push(call)
    if (failure) throw failure
    if (respond) return respond(call)
    return { status: 200, body: JSON.stringify({ friends: [] }), headers: [] }
  }
  const context = {
    exports, Headers, Request, Response, Uint8Array, performance, TypeError,
    console: { log() {}, warn() {}, error() {} },
    testEnv: { DEV: false },
    window: {
      launcherAPI: {
        getAuthKey: async () => authKey,
      },
    },
    require(name) {
      if (name === '@/lib/http-fetch') {
        const exports = {}
        runInNewContext(transpile('../src/lib/http-fetch.ts'), { ...context, exports })
        return exports
      }
      if (name === '@tauri-apps/api/core') return {
        isTauri: () => desktop,
        async invoke(command, args) {
          if (command === 'friends_debug_log_write') {
            // The bearer must never reach the on-disk debug log.
            assert.ok(!args.message.includes('test-auth-key'))
            return
          }
          assert.equal(command, 'http_fetch')
          const headers = new Headers(args.headers)
          const auth = headers.get('Authorization')
          const response = await request({
            transport: 'ipc',
            url: args.url,
            method: args.method,
            ifNoneMatch: headers.get('If-None-Match'),
            contentType: headers.get('Content-Type'),
            bearer: auth ? auth.slice('Bearer '.length) : null,
            body: args.body === null ? null : Buffer.from(args.body).toString(),
          })
          return {
            status: response.status,
            statusText: '',
            headers: response.headers ?? [],
            url: args.url,
            body: Array.from(Buffer.from(response.body ?? '')),
          }
        },
      }
      throw new Error(`Unexpected import: ${name}`)
    },
    async fetch(url, init) {
      assert.equal(desktop, false, 'Desktop must never fall back to WebView fetch')
      const headers = new Headers(init.headers)
      const auth = headers.get('Authorization')
      assert.equal(init.credentials, 'omit')
      const response = await request({
        transport: 'fetch',
        url,
        method: init.method ?? 'GET',
        ifNoneMatch: headers.get('If-None-Match'),
        contentType: headers.get('Content-Type'),
        bearer: auth ? auth.slice('Bearer '.length) : null,
        body: init.body ?? null,
      })
      // 204 / 205 / 304 are null-body statuses: the Response
      // constructor rejects any body for them, empty string included.
      const nullBody = [204, 205, 304].includes(response.status)
      return new Response(nullBody ? null : response.body, {
        status: response.status,
        headers: response.headers ?? [],
      })
    },
  }
  context.globalThis = context
  runInNewContext(gameApiSource, context)
  return { api: exports, calls }
}

const BASE = 'http://217.160.250.198:8126'

for (const desktop of [true, false]) {
  const platform = desktop ? 'desktop' : 'browser'
  const transport = desktop ? 'ipc' : 'fetch'

  test(`${platform}: requests carry the launcher bearer to the game server`, async () => {
    const h = setup(desktop)
    await h.api.gameFetch('/api/friends')
    assert.deepEqual(h.calls, [{
      transport,
      url: `${BASE}/api/friends`,
      method: 'GET',
      ifNoneMatch: null,
      contentType: null,
      bearer: 'test-auth-key',
      body: null,
    }])
  })

  test(`${platform}: a missing auth key sends no Authorization header`, async () => {
    const h = setup(desktop, { authKey: null })
    await h.api.gameFetch('/api/friends')
    assert.equal(h.calls[0].bearer, null)
  })

  test(`${platform}: an explicit null bearer suppresses the header on public endpoints`, async () => {
    const h = setup(desktop)
    await h.api.gameFetch('/avatar/player', { bearer: null })
    assert.equal(h.calls[0].bearer, null)
  })

  test(`${platform}: bodies imply POST and survive the transport verbatim`, async () => {
    const h = setup(desktop, { respond: () => ({ status: 200, body: '{"ok":true}' }) })
    await h.api.gameFetch('/api/friends/request', {
      body: JSON.stringify({ name: 'péché/1' }),
      headers: { 'Content-Type': 'application/json' },
    })
    assert.equal(h.calls[0].method, 'POST')
    assert.equal(h.calls[0].contentType, 'application/json')
    assert.equal(h.calls[0].body, '{"name":"péché/1"}')
  })

  test(`${platform}: explicit verbs are preserved and never coerced to POST`, async () => {
    const h = setup(desktop, { respond: () => ({ status: 204, body: '' }) })
    await h.api.gameFetch('/avatar', { method: 'DELETE' })
    assert.equal(h.calls[0].method, 'DELETE')
  })

  test(`${platform}: encoded path segments reach the server unchanged`, async () => {
    const h = setup(desktop)
    const path = `/api/friends/search?q=${encodeURIComponent('a b&c=d')}`
    await h.api.gameFetch(path)
    assert.equal(new URL(h.calls[0].url).search, '?q=a%20b%26c%3Dd')
  })

  test(`${platform}: HTTP errors raise GameApiError carrying status and parsed body`, async () => {
    const h = setup(desktop, {
      respond: () => ({ status: 401, body: JSON.stringify({ error: 'auth key is required' }) }),
    })
    const error = await h.api.gameFetch('/api/friends').then(
      () => null,
      (err) => err,
    )
    assert.ok(error instanceof h.api.GameApiError)
    assert.equal(error.status, 401)
    assert.equal(h.api.mapGameApiAuthReason(error), 'missing_auth_header')
  })

  test(`${platform}: a refusal that arrives as 2xx is returned, not thrown`, async () => {
    // The game server answers refusals with HTTP 200 and `ok: false`.
    // Throwing here would make "already friends" indistinguishable
    // from a transport failure.
    const h = setup(desktop, {
      respond: () => ({ status: 200, body: JSON.stringify({ ok: false, reason: 'already_friends' }) }),
    })
    const result = await h.api.gameFetch('/api/friends/request')
    structural(result, { ok: false, reason: 'already_friends' })
  })

  test(`${platform}: transport failures surface as errors and are not retried`, async () => {
    const h = setup(desktop, { failure: new TypeError('Failed to fetch') })
    const error = await h.api.gameFetch('/api/friends/remove', { body: '{}' }).then(
      () => null,
      (err) => err,
    )
    assert.equal(typeof error?.message, 'string')
    assert.match(error.message, /Failed to fetch/)
    assert.equal(h.calls.length, 1, 'a failed mutation must not be replayed')
  })

  test(`${platform}: the etag helper sends If-None-Match and short-circuits on 304`, async () => {
    const h = setup(desktop, {
      respond: (call) => call.ifNoneMatch === 'W/"v1"'
        ? { status: 304, body: '', headers: [['etag', 'W/"v1"']] }
        : { status: 200, body: JSON.stringify({ friends: [] }), headers: [['etag', 'W/"v1"']] },
    })
    const first = await h.api.gameFetchWithEtag('/api/friends', null)
    structural(first, { graph: { friends: [] }, etag: 'W/"v1"' })

    const second = await h.api.gameFetchWithEtag('/api/friends', first.etag)
    structural(second, { graph: null, etag: 'W/"v1"' })
    assert.equal(h.calls[1].ifNoneMatch, 'W/"v1"')
  })
}

test('desktop keeps every game API request off the WebView transport', async () => {
  // The assertion that matters for the CORS fix: `setup(true)`
  // makes the context's `fetch` fail the test outright, so this
  // exercises the paths a friends poll actually walks.
  const h = setup(true, {
    respond: () => ({ status: 200, body: '{}', headers: [['etag', 'W/"v1"']] }),
  })
  await h.api.gameFetch('/api/friends')
  await h.api.gameFetch('/api/friends/accept', { body: '{"id":"x"}' })
  await h.api.gameFetchWithEtag('/api/friends', null)
  assert.equal(h.calls.length, 3)
  assert.deepEqual([...new Set(h.calls.map((c) => c.transport))], ['ipc'])
})
