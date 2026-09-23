const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const source = readFileSync(require.resolve('../src/lib/friends.ts'), 'utf8')
const { outputText } = ts.transpileModule(source.replaceAll('import.meta.env', 'testEnv'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})

function setup(desktop, { respond, failure, token = 'test-token', env = {} } = {}) {
  const calls = []
  const exports = {}
  async function request(call) {
    calls.push(call)
    if (failure) throw failure
    if (respond) return respond(call)
    if (call.method !== 'GET') return { status: 204, body: '' }
    if (call.url.includes('search-users')) return {
      status: 200, body: JSON.stringify({ users: [{ id: 'player', displayName: 'Player', relationState: 'none' }] }),
    }
    return { status: 200, body: JSON.stringify({ friends: [{ id: 'friend', displayName: 'Friend' }], requests: [] }) }
  }
  const context = {
    exports, Headers, Request, Response, Uint8Array, performance,
    console: { log() {}, warn() {}, error() {} },
    testEnv: { DEV: false, ...env },
    require(name) {
      if (name === '@/lib/http-fetch') {
        const source = readFileSync(require.resolve('../src/lib/http-fetch.ts'), 'utf8')
        const { outputText } = ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        })
        const exports = {}
        runInNewContext(outputText, { ...context, exports })
        return exports
      }
      if (name === '@/lib/auth') return { readPersistedToken: () => token ? { token } : null }
      if (name === '@/config/launcher') return { LAUNCHER_CONFIG: { friendsApiBaseUrl: 'https://api.zemu.uk' } }
      if (name === '@tauri-apps/api/core') return {
        isTauri: () => desktop,
        async invoke(command, args) {
          if (command === 'friends_debug_log_write') {
            assert.ok(!args.message.includes('test-token'))
            return
          }
          assert.equal(command, 'http_fetch')
          const headers = new Headers(args.headers)
          const auth = headers.get('Authorization')
          const response = await request({ transport: 'ipc', ...args,
            bearer: auth ? auth.slice('Bearer '.length) : null,
            body: args.body === null ? null : Buffer.from(args.body).toString(),
          })
          return { ...response, statusText: '', headers: [], url: args.url,
            body: Array.from(Buffer.from(response.body)) }

        },
      }
      throw new Error(`Unexpected import: ${name}`)
    },
    async fetch(url, init) {
      assert.equal(desktop, false, 'Desktop must never fall back to WebView fetch')
      assert.equal(init.credentials, 'omit')
      assert.equal(init.headers.get('Accept'), 'application/json')
      const auth = init.headers.get('Authorization')
      const response = await request({
        transport: 'fetch', url, method: init.method ?? 'GET',
        bearer: auth ? auth.slice('Bearer '.length) : null, body: init.body ?? null,
      })
      return new Response(response.status === 204 ? null : response.body, { status: response.status })
    },
  }
  runInNewContext(outputText, context)
  return { dispatch: exports.dispatchFriends, calls }
}

const actions = ['list', 'profile', 'search', 'request', 'accept', 'decline', 'cancel', 'remove']
for (const desktop of [true, false]) {
  const platform = desktop ? 'desktop' : 'browser'

  test(`${platform}: list and profile load the three authenticated lists`, async () => {
    for (const action of ['list', 'profile']) {
      const h = setup(desktop)
      const result = await h.dispatch(action)
      assert.equal(result.ok, true)
      assert.equal(result.friends[0].relationship, 'friend')
      assert.deepEqual(h.calls.map(c => new URL(c.url).pathname), [
        '/v1/friends', '/v1/friends/requests/incoming', '/v1/friends/requests/outgoing',
      ])
      assert.ok(h.calls.every(c => c.method === 'GET' && c.bearer === 'test-token'))
      assert.ok(h.calls.every(c => c.transport === (desktop ? 'ipc' : 'fetch')))
    }
  })

  test(`${platform}: search preserves encoded queries and result normalization`, async () => {
    const h = setup(desktop)
    const result = await h.dispatch('search', { query: 'été / &' })
    assert.equal(result.ok, true)
    assert.equal(result.results[0].id, 'player')
    assert.equal(h.calls[0].url, 'https://api.zemu.uk/v1/friends/search-users?q=%C3%A9t%C3%A9%20%2F%20%26&limit=10')
  })

  test(`${platform}: mutations preserve verbs, encoded IDs, DELETE JSON, and empty success bodies`, async () => {
    for (const [action, method, suffix, body] of [
      ['request', 'POST', '', null], ['accept', 'POST', '/accept', null],
      ['decline', 'POST', '/decline', null], ['cancel', 'DELETE', '', null],
      ['remove', 'DELETE', '', '{"kind":"friend"}'],
    ]) {
      const h = setup(desktop)
      const result = await h.dispatch(action, { targetId: 'player / é' })
      assert.equal(result.ok, true)
      assert.equal(h.calls.length, 2)
      assert.equal(h.calls[0].url, `https://api.zemu.uk/v1/friends/requests/player%20%2F%20%C3%A9${suffix}`)
      assert.equal(h.calls[0].method, method)
      assert.equal(h.calls[0].body, body)
      assert.equal(h.calls[0].bearer, 'test-token')
      assert.equal(h.calls[1].method, 'GET')
    }
  })

  test(`${platform}: every action preserves 401 instead of reporting a successful mutation`, async () => {
    for (const action of actions) {
      const h = setup(desktop, { respond: () => ({ status: 401, body: '{"error":"expired"}' }) })
      const result = await h.dispatch(action, { targetId: 'player', query: 'player' })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'unauthenticated')
      if (!['list', 'profile'].includes(action)) assert.equal(h.calls.length, 1)
    }
  })

  test(`${platform}: HTTP and transport failures remain distinguishable and never retry mutations`, async () => {
    for (const [options, reason] of [
      [{ respond: () => ({ status: 409, body: '{"error":"already_pending"}' }) }, 'already_pending'],
      [{ respond: () => ({ status: 403, body: '{"message":"forbidden"}' }) }, 'forbidden'],
      [{ respond: () => ({ status: 503, body: '<html>Unavailable</html>' }) }, 'HTTP 503'],
      [{ failure: 'Friends API request failed: timed out' }, 'network_error'],
      [{ failure: new TypeError('Load failed') }, 'network_error'],
    ]) {
      const h = setup(desktop, options)
      const result = await h.dispatch('request', { targetId: 'player' })
      assert.equal(result.ok, false)
      assert.equal(result.reason, reason)
      assert.equal(h.calls.length, 1)
    }
  })
}

test('development URL overrides and missing tokens reach the native transport unchanged', async () => {
  const h = setup(true, {
    token: null,
    env: { DEV: true, VITE_API_URL: 'http://localhost:3002/' },
    respond: () => ({ status: 401, body: '' }),
  })
  assert.equal((await h.dispatch('search', { query: 'player' })).reason, 'unauthenticated')
  assert.equal(h.calls[0].url, 'http://localhost:3002/v1/friends/search-users?q=player&limit=10')
  assert.equal(h.calls[0].bearer, null)
})
