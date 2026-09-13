const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function setup(platform, { status = 200, body = '[]', failure, env = {} } = {}) {
  const calls = []
  const cache = new Map()
  const config = {
    newsApiBaseUrl: 'https://api.zemu.uk/v1/news',
    statsApiBaseUrl: 'https://api.zemu.uk/v1/stats',
  }
  function load(name) {
    if (name === '@tauri-apps/api/core') return {
      isTauri: () => platform !== 'browser',
      async invoke(command, args) {
        assert.equal(command, 'public_api_get')
        calls.push({ transport: 'ipc', url: args.url })
        if (platform !== 'linux') return null
        if (failure) throw failure
        return { status, body }
      },
    }
    if (name === '@/config/launcher') return { LAUNCHER_CONFIG: config }
    if (cache.has(name)) return cache.get(name)
    const source = readFileSync(require.resolve(`../src/${name.slice(2)}.ts`), 'utf8')
    const { outputText } = ts.transpileModule(source.replaceAll('import.meta.env', 'testEnv'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    })
    const exports = {}
    cache.set(name, exports)
    runInNewContext(outputText, {
      exports, require: load, testEnv: { DEV: false, ...env }, URLSearchParams,
      async fetch(url) {
        calls.push({ transport: 'fetch', url })
        if (platform === 'linux') throw new Error('Linux must not use WebView fetch')
        if (failure) throw failure
        return new Response(body, { status })
      },
    })
    return exports
  }
  return { load, calls }
}

for (const platform of ['linux', 'windows', 'macos', 'browser']) {
  test(`${platform}: news, leaderboard filters, and streams keep their response contracts`, async () => {
    const cases = [
      ['@/lib/news', 'fetchNewsList', [], '[{"slug":"hello"}]', '/v1/news', value => assert.equal(value[0].slug, 'hello')],
      ['@/lib/news', 'fetchNewsBySlug', ['été / test'], '{"bodyHtml":"<p>News</p>"}', '/v1/news/%C3%A9t%C3%A9%20%2F%20test', value => assert.equal(value.bodyHtml, '<p>News</p>')],
      ['@/lib/leaderboard', 'fetchTopLeaderboard', [{ limit: 1, tier: 'gold' }], '{"entries":[{"name":"A","tier":"gold"},{"name":"B","tier":"gold"}]}', '/v1/stats/leaderboards', value => assert.equal(value.length, 1)],
      ['@/api/streams', 'fetchStreams', [], '{"twitch":[],"kick":[],"fetchedAt":"now"}', '/streams', value => assert.equal(value.fetchedAt, 'now')],
    ]
    for (const [module, fn, args, body, path, check] of cases) {
      const h = setup(platform, { body })
      check(await h.load(module)[fn](...args))
      assert.equal(h.calls.at(-1).url, `https://api.zemu.uk${path}`)
      assert.equal(h.calls.filter(c => c.transport === 'fetch').length, platform === 'linux' ? 0 : 1)
      assert.equal(h.calls.filter(c => c.transport === 'ipc').length, platform === 'browser' ? 0 : 1)
    }
  })

  test(`${platform}: news 404 stays null even with a non-JSON body`, async () => {
    const h = setup(platform, { status: 404, body: '<html>Not found</html>' })
    assert.equal(await h.load('@/lib/news').fetchNewsBySlug('missing'), null)
  })

  test(`${platform}: rank filtering happens before the top-five limit`, async () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({ name: `Gold ${i}`, tier: 'gold', position: i + 1 })),
      { name: 'Silver', tier: 'silver', position: 6 },
      ...Array.from({ length: 7 }, (_, i) => ({ name: `Bronze ${i}`, tier: 'bronze', position: i + 7 })),
    ]
    const h = setup(platform, { body: JSON.stringify({ entries }) })
    const { fetchTopLeaderboard } = h.load('@/lib/leaderboard')
    const bronze = await fetchTopLeaderboard({ tier: 'bronze' })
    assert.equal(bronze.length, 5)
    assert.deepEqual(Array.from(bronze, e => e.position), [7, 8, 9, 10, 11])
    assert.ok(bronze.every(e => e.tier === 'bronze'))
    const silver = await fetchTopLeaderboard({ tier: 'silver' })
    assert.deepEqual(Array.from(silver, e => e.name), ['Silver'])
    assert.equal((await fetchTopLeaderboard({ tier: 'diamond' })).length, 0)
    const all = await fetchTopLeaderboard({ tier: 'all' })
    assert.deepEqual(Array.from(all, e => e.position), [1, 2, 3, 4, 5])
    assert.equal((await fetchTopLeaderboard({ tier: 'bronze', limit: 2 })).length, 2)
    // Do not ask the API to truncate the data before local filtering.
    assert.ok(h.calls.every(c => !c.url.includes('?')))
  })

  test(`${platform}: HTTP, JSON, and network failures are not treated as empty feeds`, async () => {
    for (const [module, fn] of [['@/lib/news', 'fetchNewsList'], ['@/lib/leaderboard', 'fetchTopLeaderboard'], ['@/api/streams', 'fetchStreams']]) {
      await assert.rejects(setup(platform, { status: 503 }).load(module)[fn](), /HTTP 503/)
      await assert.rejects(setup(platform, { body: '<html>Invalid JSON</html>' }).load(module)[fn]())
      const h = setup(platform, { failure: 'connection refused' })
      await assert.rejects(h.load(module)[fn](), platform === 'linux' ? /connection refused/ : undefined)
      assert.equal(h.calls.filter(c => c.transport === 'fetch').length, platform === 'linux' ? 0 : 1)
    }
  })
}

test('development API overrides reach the native transport unchanged', async () => {
  const env = { DEV: true, VITE_NEWS_API_BASE_URL: 'http://localhost:3002/v1/news', VITE_STATS_API_BASE_URL: 'http://localhost:3002/v1/stats', VITE_STREAMS_API_BASE_URL: 'http://localhost:3002' }
  for (const [module, fn, path] of [['@/lib/news', 'fetchNewsList', '/v1/news'], ['@/lib/leaderboard', 'fetchTopLeaderboard', '/v1/stats/leaderboards'], ['@/api/streams', 'fetchStreams', '/streams']]) {
    const h = setup('linux', { env, body: '{"entries":[]}' })
    await h.load(module)[fn]()
    assert.equal(h.calls[0].url, `http://localhost:3002${path}`)
  }
})
