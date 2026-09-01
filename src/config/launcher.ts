export const LAUNCHER_CONFIG = {
  name: 'ZEmu Launcher',
  version: '0.1.17',
  company: 'ZEmu',
  // Public URL the launcher hits to fetch version.json + .arc archives.
  // Bundled into update-config.json by scripts/sync-launcher-config.cjs.
  updateBaseUrl: 'https://assets.zemu.uk',
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
  // Public news API. The renderer fetches `/v1/news` and `/v1/news/:slug`
  // directly from this host. In dev, override via VITE_NEWS_API_BASE_URL
  // in `.env.local` to point at a local checkout of
  // zemu-website/apps/api (defaults to port 3002 — see
  // `apps/api/src/main.ts`).
  newsApiBaseUrl: 'https://api.zemu.uk/v1/news',
  // Stats API for leaderboards and player data.
  statsApiBaseUrl: 'https://api.zemu.uk/v1/stats',
  // License API (NestJS) for validating license keys and PC-binding.
  // The renderer POSTs to {licenseApiBaseUrl}/v1/licenses/validate with
  // { licenseKey, pcIdentifier }. Override via VITE_LICENSE_API_BASE_URL
  // in `.env.local` for dev against a local checkout of
  // zemu-website/apps/api (defaults to port 3002 — see
  // `apps/api/src/main.ts`).
  licenseApiBaseUrl: 'https://api.zemu.uk',
  // Deep-link scheme registered with the OS so the OAuth callback can hand
  // control back to the running launcher.
  oauthCallbackProtocol: 'zemu-launcher://',
  // Executable the launcher spawns after a successful install + launch.
  gameExecutable: 'H1Z1.exe',
} as const
