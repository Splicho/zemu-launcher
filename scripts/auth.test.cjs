const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

// Exercise the renderer's real OAuth flow with a simulated Tauri boundary.
// Vite normally replaces import.meta.env during the build.
const source = readFileSync(require.resolve('../src/lib/auth.ts'), 'utf8')
const { outputText } = ts.transpileModule(source.replaceAll('import.meta.env', 'testEnv'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})

function setup({ pending = null, listenError = null, onListen = null } = {}) {
  let listener
  let unsubscribeCount = 0
  const calls = []
  const token = { token: 'test-bearer', userId: 'steam-user', provider: 'steam' }
  const exports = {}
  runInNewContext(outputText, {
    exports,
    testEnv: { DEV: false },
    console,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === '@tauri-apps/api/core') return {
        async invoke(command, args) {
          calls.push({ command, args })
          if (command === 'auth_open_oauth') return { success: true, state: 'expected' }
          if (command === 'auth_take_pending_oauth_callback') return pending
          if (command === 'auth_complete_oauth_token') return token
          if (command === 'auth_stop_oauth_callback_server') return
          throw new Error(`Unexpected command: ${command}`)
        },
      }
      if (name === '@tauri-apps/api/event') return {
        async listen(event, callback) {
          assert.equal(event, 'oauth-callback')
          if (listenError) throw listenError
          listener = callback
          onListen?.(callback)
          return () => { unsubscribeCount++ }
        },
      }
      if (name === '@/config/launcher') return { LAUNCHER_CONFIG: {} }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return {
    auth: exports,
    calls,
    token,
    emit: (payload) => listener({ payload }),
    get unsubscribeCount() { return unsubscribeCount },
  }
}

test('Steam login consumes a callback that arrived before subscribing', async () => {
  const harness = setup({ pending: { state: 'expected', token: 'test-bearer' } })
  const { state } = await harness.auth.initiateOAuth('steam')
  const token = await harness.auth.awaitOAuthCallback(state, 1000)
  assert.equal(token, harness.token)
  assert.equal(harness.calls[0].args.provider, 'steam')
  assert.equal(harness.calls[0].args.isDevRuntime, false)
  assert.equal(harness.calls.find(c => c.command === 'auth_take_pending_oauth_callback').args.expectedState, state)
  assert.equal(harness.unsubscribeCount, 1)
  assert.equal(harness.calls.filter(c => c.command === 'auth_complete_oauth_token').length, 1)
})

test('ignores another flow and exchanges a duplicate callback only once', async () => {
  const harness = setup()
  const result = harness.auth.awaitOAuthCallback('expected', 1000)
  harness.emit({ state: 'other', token: 'wrong-token' })
  harness.emit({ state: 'expected', token: 'test-bearer' })
  harness.emit({ state: 'expected', token: 'test-bearer' })
  assert.equal(await result, harness.token)
  assert.equal(harness.calls.filter(c => c.command === 'auth_complete_oauth_token').length, 1)
  assert.equal(harness.calls.find(c => c.command === 'auth_complete_oauth_token').args.token, 'test-bearer')
  assert.equal(harness.unsubscribeCount, 1)
})

test('cleans up when callback fires before listen resolves', async () => {
  const harness = setup({ onListen: callback => callback({ payload: { state: 'expected', token: 'test-bearer' } }) })
  assert.equal(await harness.auth.awaitOAuthCallback('expected', 1000), harness.token)
  assert.equal(harness.unsubscribeCount, 1)
})

test('provider errors and missing tokens are reported without exchanging', async () => {
  for (const [payload, expected] of [
    [{ state: 'expected', error: 'access_denied' }, /access_denied/],
    [{ state: 'expected' }, /missing token/],
  ]) {
    const harness = setup({ pending: payload })
    await assert.rejects(harness.auth.awaitOAuthCallback('expected', 1000), expected)
    assert.equal(harness.calls.some(c => c.command === 'auth_complete_oauth_token'), false)
    assert.equal(harness.calls.at(-1).command, 'auth_stop_oauth_callback_server')
    assert.equal(harness.unsubscribeCount, 1)
  }
})

test('timeout stops only the listener owned by this flow', async () => {
  const harness = setup()
  await assert.rejects(harness.auth.awaitOAuthCallback('expected', 10), /timed out/)
  const stop = harness.calls.at(-1)
  assert.equal(stop.command, 'auth_stop_oauth_callback_server')
  assert.equal(stop.args.expectedState, 'expected')
  assert.equal(harness.unsubscribeCount, 1)
})

test('subscription errors are surfaced immediately and stop the server', async () => {
  const harness = setup({ listenError: new Error('subscription failed') })
  await assert.rejects(harness.auth.awaitOAuthCallback('expected', 1000), /subscription failed/)
  assert.equal(harness.calls.at(-1).command, 'auth_stop_oauth_callback_server')
})
