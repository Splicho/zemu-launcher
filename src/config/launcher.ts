export const LAUNCHER_CONFIG = {
  name: 'ZEmu Launcher',
  version: '0.1.81',
  company: 'ZEmu',
  // Public URL the launcher hits to fetch version.json + .tar.zst archives.
  // Bundled into update-config.json by scripts/sync-launcher-config.cjs.
  updateBaseUrl: 'https://cdn-c.zemu.uk',
  // Auth.js (Next.js) on id.zemu.uk. The web-session cookie is scoped to
  // .zemu.uk in production, so the launcher exchanges the bearer token it
  // receives from /api/launcher/oauth/initiate via the standard Auth.js flow.
  // The Rust backend uses this base for:
  //   - POST /api/launcher/auth/login         (credentials login JSON)
  //   - GET  /api/launcher/user               (after OAuth, fetch user)
  //   - GET  /api/launcher/oauth/introspect   (startup token check)
  //   - GET  /api/launcher/oauth/initiate     (browser redirect start)
  //   - GET  /api/launcher/oauth/complete     (session cookie → bearer JWT → 302)
  apiBaseUrl: 'https://id.zemu.uk',
  // Friends API. The launcher exchanges the bearer JWT it received
  // from the auth app into `Authorization: Bearer …` calls against
  // the zemu-website NestJS api (port 3002 in dev, api.zemu.uk in
  // prod). In dev, set VITE_API_URL=http://localhost:3002 in
  // `.env.local` to point the launcher at a local api checkout.
  friendsApiBaseUrl: 'https://api.zemu.uk',
  // Public URL of the website's account settings page. Shown in
  // the onboarding / account banners when the auth key is revoked
  // — the user has to walk over to the website to request a
  // restore, since the launcher deliberately can't mint a fresh
  // key against an already-revoked identity.
  accountSettingsUrl: 'https://zemu.uk/settings/account',
  // Public news API. The renderer fetches `/v1/news` and
  // `/v1/news/:slug` from this host. In dev, set
  // VITE_API_URL=http://localhost:3002 in `.env.local`.
  newsApiBaseUrl: 'https://api.zemu.uk/v1/news',
  // Public events calendar (launcher home page's "Upcoming events"
  // table). Same host as news; in dev, VITE_API_URL applies the same
  // way. Backed by `apps/api/src/events`.
  eventsApiBaseUrl: 'https://api.zemu.uk/v1/events',
  // Stats API for leaderboards and player data. In dev, set
  // VITE_API_URL=http://localhost:3002 in `.env.local`.
  statsApiBaseUrl: 'https://api.zemu.uk/v1/stats',
  // Public clan tag lookup (`?names=a,b,c` → name/clantag pairs). Used by
  // the Slayers table to decorate rows with the equipped clan tag; the
  // leaderboard app calls the same route.
  clansApiBaseUrl: 'https://api.zemu.uk/v1/clans',
  // Public zemu.uk website. The launcher uses this for player
  // profile pages and the clan directory — both are public, no
  // auth. JSON shapes mirror the web app's /api routes exactly.
  // In dev, set VITE_WEB_URL=http://localhost:3000 in `.env.local`.
  webBaseUrl: 'https://zemu.uk',
  // Socket.IO realtime fan-out URL. The Rust backend connects here
  // (not the renderer) and forwards `friends:changed` events to the
  // renderer over Tauri's internal event bus. In dev, set
  // VITE_LAUNCHER_REALTIME_URL=ws://localhost:3007 in `.env.local`.
  realtimeUrl: 'wss://socket.zemu.uk',
  // Deep-link scheme registered with the OS so the OAuth callback can hand
  // control back to the running launcher.
  oauthCallbackProtocol: 'zemu-launcher://',
  // Executable the launcher spawns after a successful install + launch.
  gameExecutable: 'H1Z1.exe',
  // Files the update check + pre-launch integrity verifier should
  // ignore entirely — they are never hashed on disk, never part of the
  // "update available" verdict, and never re-downloaded. Matched by
  // exact filename (case insensitive), relative to the game install
  // root.
  //
  // `updateSkipFiles` is for files the launcher owns outright and that
  // the depot never has a useful version of. Only `catnip-client.cfg`
  // belongs here: the launcher rewrites `auth_key` /
  // `allow_insecure_http` on every launch and everything else in the
  // file is user state.
  //
  // `ClientConfig.ini` is deliberately **not** in this list even
  // though H1Z1 rewrites it at runtime. Skipping it would mean a
  // shipped default change never reaches existing installs; not
  // skipping it means the pre-launch verifier re-downloads it on
  // every launch because its hash can never match the manifest. The
  // updater instead treats it as a **seed file**
  // (`client_config::is_seed_path`): update detection compares the
  // manifest hashes only (never the live file's size/hash), the
  // downloaded default is three-way-merged into the user's file
  // (`ClientConfig.ini` vs. the previous default kept in
  // `ClientConfig.default.ini`) instead of overwriting it, and the
  // integrity walk skips it. `dinput8.dll`-style user overrides can
  // go in this list if they should never be touched.
  updateSkipFiles: ['catnip-client.cfg'],
} as const
