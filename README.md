# Zemu Launcher

A Tauri 2 + React + TypeScript launcher for the Zemu client. Modeled on the
self-updating patterns from `abyssal-gate-launcher`: a single-instance Tauri
shell that hosts the React UI, talks to the zemu-website Auth.js backend
for login, and pulls game assets down as `.tar.zst` archives.

## Project status

| Layer | Status |
| --- | --- |
| Tauri 2 backend (Rust) | ✅ scaffolded — `src-tauri/src/` mirrors abyssal-gate |
| Self-update (Tauri updater + `version.json`/`.tar.zst`) | ✅ scaffolded |
| GitHub Actions release pipeline (NSIS + updater JSON) | ✅ scaffolded |
| Discord Rich Presence | ✅ scaffolded (placeholder client ID) |
| Auth.js / OAuth integration with zemu-website | ✅ wired (Discord / Steam hosted + JSON credentials login) |
| Frontend UI (login, install, settings, news, play) | ⏳ not started — coming next |

This commit ships the **backend + release plumbing** so the frontend can be
built on top of a working IPC surface.

## Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind 4, shadcn/ui, Radix,
  Framer Motion, React Router 7, TanStack Query, react-markdown, swiper
- **Backend**: Tauri 2 (Rust) + `tauri-plugin-single-instance` +
  `tauri-plugin-deep-link` + `tauri-plugin-updater`
- **Update extractor**: in-process `tar` + `zstd` (pure Rust via the
  `tar` and `zstd` crates). No external extractor binary is shipped
  with the launcher.
- **Auth**: bearer-token exchange with `id.zemu.uk/api/launcher/*`
  (Auth.js Discord / Steam providers on the website, plus a JSON
  credentials endpoint the launcher's React login form POSTs to). The
  launcher calls `auth_open_oauth("discord"|"steam", ...)` to open the
  hosted flow, or POSTs directly to `/api/launcher/auth/login` for
  email+password.
- **Discord**: `discord-rich-presence` crate, runs in a background worker
  thread with auto-reconnect

## Repository layout

```
.
├── assets/                       # Bundled non-code resources
│   └── icon/                     # App icon (referenced by tauri.conf.json)
├── scripts/
│   ├── sync-launcher-config.cjs  # Single source of truth for version + protocol
│   ├── assert-release-tag.cjs    # CI guard: tag must match src/config/launcher.ts
│   ├── generate-tauri-icons.ps1  # Icon regeneration helper
│   └── make-placeholder-icon.ps1 # Initial icon.png generator
├── src/                          # React + TS frontend (placeholder UI for now)
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   │   ├── default.json
│   │   └── bootstrap.json
│   ├── icons/                    # Tauri icon set, regenerated via `pnpm icon:generate`
│   └── src/
│       ├── main.rs               # Entry point
│       ├── lib.rs                # Tauri builder, plugin wiring, deep-link routing
│       ├── commands.rs           # Tauri IPC bindings (the frontend's API surface)
│       ├── models.rs             # Serde types: AuthToken, VersionManifest, UpdateStatus, ...
│       ├── storage.rs            # launcher-config.json + auth-store.json + game-version.json
│       ├── state.rs              # Shared AppState (update runtime, game runtime, oauth)
│       ├── auth.rs               # Token persistence, OAuth state machine, deep-link handling
│       ├── oauth_server.rs       # tiny_http server on 127.0.0.1:31337 for dev callbacks
│       ├── update.rs             # tar+zstd-based update pipeline (.tar.zst → game dir)
│       ├── game.rs               # Game directory mgmt + H1Z1.exe launch + process-tree monitor
│       ├── api.rs                # Generic bearer-auth passthrough to zemu-website
│       ├── discord.rs            # Discord Rich Presence worker thread
│       └── debug_log.rs          # Rotating launch log file
├── .github/workflows/
│   ├── ci.yml                    # Warm Rust + Vite cache on every push / PR
│   └── release.yml               # Build on `v*` tag, publish NSIS + updater JSON
├── src/config/launcher.ts        # Single source of truth (synced into package.json, Cargo.toml, tauri.conf.json)
├── package.json
├── tsconfig.json
├── vite.config.mts
├── update-config.json            # CDN URL the launcher fetches version.json + .tar.zst from
└── README.md
```

## How the launcher's two update flows differ

This codebase intentionally ships **two** update mechanisms — they serve
different purposes:

1. **The Tauri updater plugin** (`tauri-plugin-updater`) updates the
   **launcher itself**. `pnpm tauri build` produces NSIS installers + an
   `latest.json` describing the latest release. On startup the running
   launcher calls the updater, downloads the new NSIS installer, applies it
   on quit, and restarts. Configuration lives in
   `src-tauri/tauri.conf.json` under `plugins.updater`.

2. **The Rust `update` module** (`src-tauri/src/update.rs`) updates the
   **game content**. The launcher fetches `<updateBaseUrl>/version.json`,
   compares it to the local `<game-directory>/version.json`, and downloads
   any changed folders/files as `.tar.zst` archives. The Rust `tar` and
   `zstd` crates extract them in-process — no external extractor binary
   is needed. Configuration lives in `update-config.json` (synced from
   `src/config/launcher.ts`).

## Single source of truth

`src/config/launcher.ts` exports a typed config object:

```ts
export const LAUNCHER_CONFIG = {
  name: 'Zemu Launcher',
  version: '0.1.0',
  company: 'Zemu',
  updateBaseUrl: 'https://cdn.zemu.uk',
  apiBaseUrl: 'https://auth.zemu.uk',
  oauthCallbackProtocol: 'zemu-launcher://',
  gameExecutable: 'H1Z1.exe',
} as const
```

`scripts/sync-launcher-config.cjs` is wired into every `pnpm dev` /
`pnpm build` invocation. It propagates:

- `version` → `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml`
- `oauthCallbackProtocol` → `src-tauri/tauri.conf.json` (`plugins.deep-link.desktop.schemes`)
- `updateBaseUrl` → `update-config.json` (bundled as a Tauri resource)

Always edit `src/config/launcher.ts` — never the synced files directly.

## Auth flow

The launcher's login screen has three buttons: **Discord**, **Steam**, and
**Email + password**. The Rust backend (`src-tauri/src/auth.rs`,
`src-tauri/src/commands.rs`) drives the flow:

1. **Discord / Steam** — `auth_open_oauth(provider)` opens the user's browser
   to `https://id.zemu.uk/api/launcher/oauth/initiate?provider=<provider>&state=<csrf>&callback=zemu-launcher://oauth/callback`.
   The auth app 302s to Auth.js's `/api/auth/signin/<provider>`, the user
   signs in, Auth.js redirects back to `/api/launcher/oauth/complete` with
   the session cookie set, the auth app mints a 24h HS256 JWT signed with
   `LAUNCHER_TOKEN_SECRET`, and 302s to `zemu-launcher://oauth/callback?token=<jwt>&state=<csrf>`.
2. **Email + password** — the launcher's React form POSTs
   `{email, password}` to `https://id.zemu.uk/api/launcher/auth/login`,
   which mirrors the website's `signInAction` checks (email verification,
   bcrypt) but skips Turnstile. The response is `{token, expiresAt, user}`.
3. **Token exchange** — `auth_complete_oauth_token(token)` calls
   `GET https://id.zemu.uk/api/launcher/user` with `Authorization: Bearer <token>`
   to populate the full `AuthToken` record cached in `auth-store.json`.
4. **Startup check** — on every launch, `auth_get_token` reads the cached
   token and (optionally) calls `GET /api/launcher/oauth/introspect` to
   validate it before showing the home screen.

The bearer JWT is HS256-signed with `LAUNCHER_TOKEN_SECRET` (distinct from
the website's `AUTH_SECRET`), scoped to the `zemu-launcher` audience and
the `id.zemu.uk` issuer, and embeds the same role + permission set the
website's session JWT callback reads off the cookie. 24h TTL means a
normal gaming session doesn't get interrupted by re-auth.

## GitHub Actions

- **`ci.yml`** — runs on every push and PR. Warms the Rust + pnpm caches
  and builds both halves so the cache is hot when a tag push triggers a
  release.
- **`release.yml`** — runs on `v*` tag push. Verifies the tag matches the
  launcher version (`scripts/assert-release-tag.cjs`) and invokes
  `tauri-action` to build NSIS installers + upload the updater JSON to
  `zemu-uk/zemu-launcher-releases`.

### Required repository secrets

| Secret | Purpose |
| --- | --- |
| `PUBLIC_RELEASES_REPO_TOKEN` | PAT with `repo` scope on `zemu-uk/zemu-launcher-releases` |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signing key (`.key` content) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key |

The updater public key currently lives in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Generate it with:

```bash
pnpm tauri signer generate --password <password>
```

Then paste the public key into `plugins.updater.pubkey` and keep the
private key + password as the GitHub secrets above.

## Local development

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `sync:launcher-config` first (so `package.json`,
`tauri.conf.json`, and `Cargo.toml` agree on the version + protocol), then
spawns the Tauri dev shell which starts Vite at `localhost:5173`.

No external extractor binary is required — game content updates use the
in-process `tar` + `zstd` extractor.

## Backend → frontend contract

The frontend talks to the backend exclusively through the Tauri IPC
commands listed in `src-tauri/src/commands.rs`. Grouped by area:

- **Window controls**: `window_minimize` / `window_maximize` / `window_restore` / `window_close`
- **App**: `app_is_packaged`, `launcher_finish_bootstrap`, `launcher_exit_app`, `launcher_restart_app`
- **Game directory**: `game_get_directory` / `game_set_directory` / `game_clear_directory` / `game_select_directory`
- **Game executable**: `game_get_executable` / `game_set_executable`
- **Game install**: `game_is_installed` / `game_get_local_version` / `game_launch` / `game_get_launch_state`
- **Update**: `game_check_update` / `game_download_update` / `game_get_update_status` / `game_cancel_download`
- **Auth**: `auth_get_token` / `auth_save_token` / `auth_clear_token` / `auth_open_oauth` / `auth_complete_oauth_token` / `auth_take_pending_oauth_callback` / `auth_manual_oauth_callback` / `auth_generate_oauth_state`
- **Config**: `launcher_set_update_base_url` / `launcher_set_oauth_callback_protocol` / `launcher_set_api_base_url`
- **Discord**: `discord_set_in_launcher` / `discord_set_activity`
- **Debug log**: `debug_log_write` / `debug_log_path` / `debug_log_read` / `debug_log_clear`
- **API proxy**: `api_get` / `api_post`

Events emitted from Rust → frontend:

- `update-progress` — `UpdateStatus` payload, fired on every progress tick during download / extract
- `auth:oauth-callback` — `OAuthCallbackPayload` payload, fired when the OAuth callback URL is parsed (deep-link or local HTTP)
- `game-launch-state` — `GameLaunchState` payload, fired when the launching/running state changes

## Next steps (frontend work)

The backend is wired so the frontend can be built incrementally:

1. **Bootstrap window** — detect on first launch, render an "Update available" / "No update" / "Preparing" UI backed by `tauri-plugin-updater`.
2. **Login screen** — three buttons (Discord / Steam / Email). Each calls `auth_open_oauth(provider, isDev)`, listens for `auth:oauth-callback`, then calls `auth_complete_oauth_token` to fetch the user record.
3. **Install flow** — directory picker, `game_check_update`, progress UI bound to `update-progress`.
4. **Play button** — gated on `auth_get_token` + `game_is_installed` + `game_get_launch_state`. Calls `game_launch`, listens for `game-launch-state`.
5. **Settings** — game directory, executable name, base URLs.

Discord Rich Presence is ready to fire automatically the moment the
launcher starts (initial "In Launcher" activity is queued in the setup
hook). The frontend doesn't need to do anything for it.
