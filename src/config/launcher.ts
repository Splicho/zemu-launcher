export const LAUNCHER_CONFIG = {
  name: 'ZEmu Launcher',
  version: '0.1.34',
  company: 'ZEmu',
  // Public URL the launcher hits to fetch version.json + .tar.zst archives.
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
  // Friends API. The launcher exchanges the bearer JWT it received
  // from the auth app into `Authorization: Bearer …` calls against
  // the zemu-website NestJS api (port 3002 in dev, api.zemu.uk in
  // prod). In dev, set VITE_API_URL=http://localhost:3002 in
  // `.env.local` to point the launcher at a local api checkout.
  friendsApiBaseUrl: 'https://api.zemu.uk',
  // Public news API. The renderer fetches `/v1/news` and
  // `/v1/news/:slug` from this host. In dev, set
  // VITE_API_URL=http://localhost:3002 in `.env.local`.
  newsApiBaseUrl: 'https://api.zemu.uk/v1/news',
  // Stats API for leaderboards and player data. In dev, set
  // VITE_API_URL=http://localhost:3002 in `.env.local`.
  statsApiBaseUrl: 'https://api.zemu.uk/v1/stats',
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
} as const
