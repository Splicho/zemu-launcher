const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const { QueryClient, QueryObserver } = require('@tanstack/react-query')
const ts = require('typescript')

const source = readFileSync(require.resolve('../src/hooks/use-leaderboard.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})

function setup(fetchLeaderboardEntries) {
  const client = new QueryClient()
  const exports = {}
  runInNewContext(outputText, {
    exports,
    require(name) {
      // Run the real hook's options through QueryObserver, which drives useQuery.
      if (name === '@tanstack/react-query') return { useQuery: options => new QueryObserver(client, options) }
      if (name === '@/lib/leaderboard') return { fetchLeaderboardEntries }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return { client, mount: exports.useLeaderboardEntries }
}

for (const entries of [[{ name: 'Player', top10TotalScore: 42 }], []]) {
  test(`first visit starts loading immediately and displays ${entries.length ? 'players' : 'an empty result'} without remounting`, async () => {
    let calls = 0
    let resolveRequest
    const request = new Promise(resolve => { resolveRequest = resolve })
    const h = setup(() => { calls++; return request })
    const observer = h.mount()
    let resolveLoaded
    const loaded = new Promise(resolve => { resolveLoaded = resolve })
    const unsubscribe = observer.subscribe(result => {
      if (result.isSuccess) resolveLoaded(result)
    })
    try {
      assert.equal(calls, 1, 'Opening the tab must start a request on a cold cache')
      assert.equal(observer.getCurrentResult().isLoading, true)
      assert.equal(observer.getCurrentResult().data, undefined)
      resolveRequest(entries)
      const result = await loaded
      assert.equal(result.isLoading, false)
      assert.deepEqual(result.data, entries)
      unsubscribe()
      const revisited = h.mount()
      const stop = revisited.subscribe(() => {})
      try {
        assert.deepEqual(revisited.getCurrentResult().data, entries)
        assert.equal(revisited.getCurrentResult().isLoading, false)
        assert.equal(calls, 1, 'A genuinely loaded result stays cached on a quick revisit')
      } finally { stop() }
    } finally {
      unsubscribe()
      h.client.clear()
    }
  })
}

test('explicit preloaded entries remain available without a redundant request', () => {
  let calls = 0
  const h = setup(async () => { calls++; return [] })
  const entries = [{ name: 'Preloaded player' }]
  const observer = h.mount(entries)
  const unsubscribe = observer.subscribe(() => {})
  try {
    assert.deepEqual(observer.getCurrentResult().data, entries)
    assert.equal(observer.getCurrentResult().isLoading, false)
    assert.equal(calls, 0)
  } finally {
    unsubscribe()
    h.client.clear()
  }
})
