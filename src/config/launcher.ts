export const LAUNCHER_CONFIG = {
  name: 'Zemu Launcher',
  version: '0.1.0',
  company: 'Zemu',
  // Public URL the launcher hits to fetch version.json + .arc archives.
  // Bundled into update-config.json by scripts/sync-launcher-config.cjs.
  updateBaseUrl: 'https://cdn.zemu.uk',
  // Auth.js (Next.js) on auth.zemu.uk. The web-session cookie is scoped to
  // .zemu.uk in production, so the launcher exchanges the bearer token it
  // receives from /api/launcher/oauth/initiate via the standard Auth.js flow.
  apiBaseUrl: 'https://auth.zemu.uk',
  // Deep-link scheme registered with the OS so the OAuth callback can hand
  // control back to the running launcher.
  oauthCallbackProtocol: 'zemu-launcher://',
  // Executable the launcher spawns after a successful install + launch.
  gameExecutable: 'H1Z1.exe',
} as const
