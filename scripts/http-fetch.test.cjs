const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function setup(desktop, { status = 200, body = '{"ok":true}', failure, headers = [], finalUrl, token = 'test-bearer', playing = false } = {}) {
  const calls = []
  const timers = []
  const cleanups = []
  function load(name) {
    if (name === '@tauri-apps/api/core') return {
      isTauri: () => desktop,
      async invoke(command, args) {
        if (command === 'get_api_base_url') return 'https://api.zemu.uk'
        assert.equal(command, 'http_fetch')
        calls.push(args)
        if (failure) throw failure
        return { status, statusText: '', headers, body: Array.from(Buffer.from(body)), url: finalUrl ?? args.url }
      },
    }
    if (name === '@tauri-apps/api/event') return {}
    if (name === 'react') return {
      useRef: current => ({ current }),
      useEffect(effect) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
    }
    if (name === '@/hooks/use-game-state-context') return {
      useGameStateContext: () => ({ state: { type: playing ? 'PLAYING' : 'READY' } }),
    }
    if (name === '@/config/launcher') return { LAUNCHER_CONFIG: { apiBaseUrl: 'https://api.zemu.uk', friendsApiBaseUrl: 'https://api.zemu.uk' } }
    const source = readFileSync(require.resolve(`../src/${name.slice(2)}.ts`), 'utf8')
    const { outputText } = ts.transpileModule(source.replaceAll('import.meta.env', 'testEnv'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    })
    const exports = {}
    runInNewContext(outputText, {
      exports, require: load, Request, Response, Uint8Array, TypeError, URLSearchParams,
      localStorage: { getItem: () => token ? JSON.stringify({ token }) : null },
      setTimeout(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer },
      clearTimeout(timer) { const i = timers.indexOf(timer); if (i !== -1) timers.splice(i, 1) },
      testEnv: { DEV: false }, console: { warn() {} },
      async fetch(url, init) {
        assert.equal(desktop, false, 'Never retry native failures in the WebView')
        calls.push({ url, ...init })
        if (failure) throw failure
        return new Response([204, 205, 304].includes(status) ? null : body, { status, headers })
      },
    })
    return exports
  }
  return { httpFetch: load('@/lib/http-fetch').httpFetch, load, calls, timers, cleanup: () => cleanups.forEach(fn => fn()) }
}

test('native requests serialize fetch bodies and arbitrary headers without adding authentication', async () => {
  const multipart = new FormData()
  multipart.append('name', 'été')
  for (const [body, expectedType, expectedBody] of [
    ['{"name":"été"}', 'text/plain', '{"name":"été"}'],
    [new URLSearchParams({ name: 'été' }), 'application/x-www-form-urlencoded', 'name=%C3%A9t%C3%A9'],
    [new Blob(['été'], { type: 'text/custom' }), 'text/custom', 'été'],
    [multipart, 'multipart/form-data', 'été'],
    [new Uint8Array([0, 128, 255]), null, null],
  ]) {
    const h = setup(true)
    await h.httpFetch(new URL('https://example.test/data'), { method: 'PATCH', headers: [['X-Custom', 'value']], body })
    const call = h.calls[0]
    assert.equal(call.method, 'PATCH')
    assert.equal(call.redirect, 'follow')
    const headers = new Headers(call.headers)
    assert.equal(headers.get('x-custom'), 'value')
    assert.equal(headers.get('authorization'), null)
    if (expectedType) assert.ok(headers.get('content-type').startsWith(expectedType))
    if (expectedBody) assert.ok(Buffer.from(call.body).toString().includes(expectedBody))
    else assert.deepEqual(Array.from(call.body), [0, 128, 255])
  }
})

test('native responses preserve binary data, response headers, status and final URL', async () => {
  const h = setup(true, { status: 404, body: Buffer.from([0, 128, 255]), headers: [['X-Test', 'value']], finalUrl: 'https://example.test/final' })
  const response = await h.httpFetch('https://example.test/start')
  assert.ok(response instanceof Response)
  assert.equal(response.status, 404)
  assert.equal(response.ok, false)
  assert.equal(response.url, 'https://example.test/final')
  assert.equal(response.redirected, true)
  assert.equal(response.headers.get('x-test'), 'value')
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [0, 128, 255])
  await assert.rejects(response.text(), TypeError)
})

test('native JSON responses support standard Response cloning and body consumption', async () => {
  const response = await setup(true).httpFetch('https://example.test/')
  const clone = response.clone()
  assert.equal(clone.url, response.url)
  assert.equal(clone.redirected, response.redirected)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(await clone.text(), '{"ok":true}')
})

test('HEAD and bodyless HTTP statuses construct valid Responses', async () => {
  for (const status of [204, 205, 304]) {
    const response = await setup(true, { status, body: '' }).httpFetch('https://example.test/')
    assert.equal(response.status, status)
    assert.equal(response.body, null)
  }
  const h = setup(true, { body: '' })
  const response = await h.httpFetch('https://example.test/', { method: 'HEAD' })
  assert.equal(response.body, null)
  assert.equal(h.calls[0].body, null)
})

test('native network failures become TypeErrors without fallback or retries', async () => {
  const h = setup(true, { failure: 'connection refused' })
  await assert.rejects(h.httpFetch('https://example.test/', { method: 'POST', body: 'data' }), /connection refused/)
  assert.equal(h.calls.length, 1)
})

test('browser requests use fetch directly with method, headers and body intact', async () => {
  const h = setup(false)
  const headers = { Authorization: 'Bearer token', 'Content-Type': 'application/json' }
  const response = await h.httpFetch('https://example.test/', { method: 'DELETE', headers, body: '{}', redirect: 'error' })
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(h.calls[0].headers, headers)
  assert.equal(h.calls[0].body, '{}')
  assert.equal(h.calls[0].credentials, 'omit')
  assert.equal(h.calls[0].redirect, 'error')
})

for (const desktop of [true, false]) {
  test(`${desktop ? 'desktop' : 'browser'}: login and introspection use the shared HTTP transport`, async () => {
    const h = setup(desktop, { body: '{"token":"jwt","user":{"id":"player","provider":"email"},"valid":true}' })
    const auth = h.load('@/lib/auth')
    const result = await auth.loginWithCredentials('test@example.test', 'password')
    assert.equal(result.token, 'jwt')
    const call = h.calls[0]
    assert.equal(call.method, 'POST')
    assert.equal(call.url, 'https://api.zemu.uk/api/launcher/auth/login')
    assert.deepEqual(JSON.parse(desktop ? Buffer.from(call.body).toString() : call.body), { email: 'test@example.test', password: 'password' })
    assert.equal((await auth.introspectToken('jwt')).valid, true)
    assert.equal(new Headers(h.calls[1].headers).get('authorization'), 'Bearer jwt')
  })
}

for (const desktop of [true, false]) {
  const platform = desktop ? 'desktop' : 'browser'
  const decodeBody = call => desktop ? Buffer.from(call.body).toString() : call.body

  test(`${platform}: auth-key retrieval preserves the bearer and error contracts`, async () => {
    for (const [options, expected] of [
      [{ body: '{"key":"game-key","status":"active"}' }, { ok: true, key: 'game-key', status: 'active' }],
      [{ status: 401, body: '{"error":"expired_token"}' }, { ok: false, reason: 'expired_token' }],
      [{ status: 503 }, { ok: false, reason: 'http_503' }],
      [{ body: '<html>error</html>' }, { ok: false, reason: 'malformed' }],
      [{ failure: 'offline' }, { ok: false, reason: 'unreachable' }],
    ]) {
      const h = setup(desktop, options)
      const result = await h.load('@/lib/auth').fetchMyAuthKey('account-token')
      assert.deepEqual(JSON.parse(JSON.stringify(result)), expected)
      assert.equal(h.calls[0].url, 'https://api.zemu.uk/api/launcher/auth/my-key')
      assert.equal(new Headers(h.calls[0].headers).get('authorization'), 'Bearer account-token')
    }
  })

  test(`${platform}: clan reads and mutations preserve authentication, encoded paths and bodies`, async () => {
    for (const [fn, args, method, path, body] of [
      ['fetchClanBySlug', ['été / clan'], 'GET', '/%C3%A9t%C3%A9%20%2F%20clan/tooltip'],
      ['fetchClanApplications', ['clan'], 'GET', '/clan/applications'],
      ['countClanApplications', ['clan'], 'GET', '/clan/applications/count'],
      ['fetchInvitesForMe', [], 'GET', '/invites-for-me'],
      ['fetchInvitesISent', [], 'GET', '/invites-i-sent'],
      ['followClan', ['clan'], 'POST', '/clan/follow'],
      ['unfollowClan', ['clan'], 'DELETE', '/clan/follow'],
      ['updateClan', ['clan', { description: 'été' }], 'PATCH', '/clan', { description: 'été' }],
    ]) {
      const h = setup(desktop, { body: '{"count":2}' })
      await h.load('@/lib/clan')[fn](...args)
      const call = h.calls[0]
      assert.equal(h.calls.length, 1)
      assert.equal(call.method ?? 'GET', method)
      assert.equal(call.url, `https://api.zemu.uk/v1/clans${path}`)
      assert.equal(new Headers(call.headers).get('authorization'), 'Bearer test-bearer')
      if (body) assert.deepEqual(JSON.parse(decodeBody(call)), body)
    }
    const anonymous = setup(desktop, { token: null, status: 404 })
    assert.equal(await anonymous.load('@/lib/clan').fetchClanBySlug('missing'), null)
    assert.equal(new Headers(anonymous.calls[0].headers).get('authorization'), null)
    const denied = setup(desktop, { status: 403, body: '{"message":"Not a leader"}' })
    await assert.rejects(denied.load('@/lib/clan').updateClan('clan', {}), /Not a leader/)
    const empty = setup(desktop, { status: 204, body: '' })
    await empty.load('@/lib/clan').unfollowClan('clan')
  })

  test(`${platform}: clan asset uploads preserve signed URLs and binary bytes without leaking the bearer`, async () => {
    const presigned = { url: 'https://assets.example.test/image?X-Amz-Signature=abc%2F123&part=1', objectKey: 'clan/image', contentDisposition: 'inline; filename="image.png"' }
    const input = { kind: 'clan-avatar', clanId: 'clan', filename: 'image.png', contentType: 'image/png', contentLength: 3 }
    const h = setup(desktop, { body: JSON.stringify(presigned) })
    const clan = h.load('@/lib/clan')
    const result = await clan.presignClanAsset(input)
    assert.equal(h.calls[0].url, 'https://api.zemu.uk/v1/clans/r2/presign')
    assert.equal(new Headers(h.calls[0].headers).get('authorization'), 'Bearer test-bearer')
    assert.deepEqual(JSON.parse(decodeBody(h.calls[0])), input)
    const blob = new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' })
    assert.equal(await clan.uploadClanAsset(result, blob), presigned.objectKey)
    const call = h.calls[1]
    assert.equal(call.method, 'PUT')
    assert.equal(call.url, presigned.url)
    const headers = new Headers(call.headers)
    assert.equal(headers.get('authorization'), null)
    assert.equal(headers.get('content-disposition'), presigned.contentDisposition)
    assert.equal(headers.get('content-type'), 'image/png')
    assert.deepEqual(Array.from(desktop ? call.body : new Uint8Array(await call.body.arrayBuffer())), [0, 128, 255])
  })

  test(`${platform}: presence heartbeats use the shared transport and stop when disabled`, async () => {
    for (const playing of [false, true]) {
      const h = setup(desktop, { playing })
      h.load('@/hooks/use-presence-heartbeat').usePresenceHeartbeat(true)
      // The 5000ms timer is the per-request timeout race inside
      // `sendHeartbeat`. The cadence assertions below only care
      // about the heartbeat interval, so peel the timeout race off.
      const initialTimer = h.timers.shift()
      assert.equal(initialTimer.delay, 2000)
      await initialTimer.callback()
      assert.equal(h.calls[0].url, 'https://api.zemu.uk/v1/presence/heartbeat')
      assert.equal(h.calls[0].method, 'POST')
      assert.equal(new Headers(h.calls[0].headers).get('authorization'), 'Bearer test-bearer')
      assert.deepEqual(JSON.parse(decodeBody(h.calls[0])), {
        status: playing ? 'in_game' : 'online', currentGame: playing ? 'ZEmu' : null,
      })
      assert.equal(h.timers.shift()?.delay, 5000) // timeout race
      assert.equal(h.timers[0].delay, 30000)
      h.cleanup()
      assert.equal(h.timers.length, 0)
    }
    const disabled = setup(desktop)
    disabled.load('@/hooks/use-presence-heartbeat').usePresenceHeartbeat(false)
    assert.equal(disabled.timers.length, 0)
    assert.equal(disabled.calls.length, 0)
  })

  test(`${platform}: presence heartbeats abort after 5s when the api stalls (the regaining timeout regression)`, async () => {
    const h = setup(desktop, {
      // Never resolve — simulates a hung api / TCP black hole.
      // The shared transport doesn't expose AbortSignal, so the
      // hook has to bound each request itself; this pins the
      // pre-PR `AbortSignal.timeout(5_000)` ceiling.
      failure: new Promise(() => {}),
    })
    const { usePresenceHeartbeat } = h.load('@/hooks/use-presence-heartbeat')
    usePresenceHeartbeat(true)
    // First beat's "wait 2s" timer fires; the request itself never
    // resolves, so the hook's outer `try` falls through to the 5s
    // timeout race instead of hanging the interval chain. Drive the
    // outer timer, then the inner 5000ms race, without relying on
    // wall-clock time.
    const initialTimer = h.timers.shift()
    assert.equal(initialTimer.delay, 2000)
    let beatSettled = false
    initialTimer.callback().then(() => { beatSettled = true }, () => {})
    const timeoutTimer = h.timers.shift()
    assert.equal(timeoutTimer?.delay, 5000)
    timeoutTimer.callback()
    // Settle pending microtasks: the race winner is the timeout,
    // the request promise lingers unresolved but its eventual
    // rejection (from the no-op `.catch()`) must not blow up.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(beatSettled, true, 'sendHeartbeat should have settled once the timeout fired')
    assert.ok(h.calls.length >= 1, 'at least one heartbeat request should have been issued before the timeout')
    h.cleanup()
  })
}
