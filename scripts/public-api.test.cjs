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
    friendsApiBaseUrl: 'https://api.zemu.uk',
  }
  function load(name) {
    if (name === '@tauri-apps/api/core') return {
      isTauri: () => platform !== 'browser',
      async invoke(command, args) {
        assert.equal(command, 'http_fetch')
        calls.push({ transport: 'ipc', url: args.url })
        if (failure) throw failure
        return { status, statusText: '', headers: [], body: Array.from(Buffer.from(body)), url: args.url }
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
      exports, require: load, testEnv: { DEV: false, ...env }, URLSearchParams, Request, Response, Uint8Array, URL,
      // `lib/site-notice.ts` logs before degrading to "no banner", so
      // the sandbox needs a console. Keep it quiet so a deliberate
      // failure-path test doesn't look like a real error.
      console: { warn() {}, error() {}, log() {} },
      async fetch(url) {
        calls.push({ transport: 'fetch', url })
        if (platform !== 'browser') throw new Error('Desktop must not use WebView fetch')
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
      assert.equal(h.calls.filter(c => c.transport === 'fetch').length, platform !== 'browser' ? 0 : 1)
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
    assert.deepEqual(Array.from(bronze, e => e.name), ['Bronze 0', 'Bronze 1', 'Bronze 2', 'Bronze 3', 'Bronze 4'])
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
      await assert.rejects(h.load(module)[fn](), platform !== 'browser' ? /connection refused/ : undefined)
      assert.equal(h.calls.filter(c => c.transport === 'fetch').length, platform !== 'browser' ? 0 : 1)
    }
  })

  // The site notice is the one public read that must NOT throw: a
  // failed fetch means the launcher renders without a bar, and it
  // has no error state to show. These cases pin that contract, plus
  // the surface echo that stops a `web` notice leaking into the
  // desktop app.
  test(`${platform}: site notice degrades to "no banner" instead of throwing`, async () => {
    const h = setup(platform, { body: 'null' })
    assert.equal(await h.load('@/lib/site-notice').fetchSiteNotice(), null)
    assert.equal(h.calls.at(-1).url, 'https://api.zemu.uk/v1/site-notice?surface=launcher')

    for (const broken of [setup(platform, { status: 500, body: 'boom' }), setup(platform, { body: '<html>Bad gateway</html>' }), setup(platform, { failure: 'connection refused' })]) {
      assert.equal(await broken.load('@/lib/site-notice').fetchSiteNotice(), null)
    }
  })

  test(`${platform}: site notice only accepts launcher-surface payloads with real text`, async () => {
    const base = { id: 'n1', variant: 'info', text: 'Maintenance tonight', linkUrl: null, linkLabel: null, isDismissible: true, surface: 'launcher' }
    const load = payload => setup(platform, { body: JSON.stringify(payload) }).load('@/lib/site-notice').fetchSiteNotice()

    // A web notice reaching the launcher means the surface was
    // ignored somewhere; rendering it here would show website copy
    // in the desktop app.
    assert.equal(await load({ ...base, surface: 'web' }), null)
    assert.equal(await load({ ...base, surface: undefined }), null)
    assert.equal(await load({ ...base, text: '' }), null)
    assert.equal(await load({ ...base, id: '' }), null)
    assert.equal(await load('a string'), null)
    assert.equal(await load(undefined), null)

    // An unknown variant degrades to neutral rather than dropping the
    // copy — losing the text because a colour token moved is worse.
    assert.equal((await load({ ...base, variant: 'chartreuse' })).variant, 'info')

    // A non-http(s) link must never reach `openUrl` / the OS.
    assert.equal((await load({ ...base, linkUrl: 'javascript:alert(1)' })).linkUrl, null)
    assert.equal((await load({ ...base, linkUrl: 'https://zemu.uk/news' })).linkUrl, 'https://zemu.uk/news')
  })
}

test('development API overrides reach the native transport unchanged', async () => {
  const env = { DEV: true, VITE_API_URL: 'http://localhost:3002' }
  for (const [module, fn, path] of [['@/lib/news', 'fetchNewsList', '/v1/news'], ['@/lib/leaderboard', 'fetchTopLeaderboard', '/v1/stats/leaderboards'], ['@/api/streams', 'fetchStreams', '/streams']]) {
    const h = setup('linux', { env, body: '{"entries":[]}' })
    await h.load(module)[fn]()
    assert.equal(h.calls[0].url, `http://localhost:3002${path}`)
  }
})

