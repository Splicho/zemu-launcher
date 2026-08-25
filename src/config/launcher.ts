export const LAUNCHER_CONFIG = {
  name: 'ZEmu Launcher',
  version: '0.1.0',
  company: 'ZEmu',
  // Public URL the launcher hits to fetch version.json + .arc archives.
  // Bundled into update-config.json by scripts/sync-launcher-config.cjs.
  updateBaseUrl: 'https://cdn.zemu.uk',
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
  // Deep-link scheme registered with the OS so the OAuth callback can hand
  // control back to the running launcher.
  oauthCallbackProtocol: 'zemu-launcher://',
  // Executable the launcher spawns after a successful install + launch.
  gameExecutable: 'H1Z1.exe',
} as const
