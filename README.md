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
| **SteamKit integration** (QR login + depot download) | ✅ implemented on `steamroom` + `steamroom-client`; single-file `src-tauri/src/depot.rs`, end-to-end scan-and-go path active |
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

## Steam integration

The launcher authenticates against Steam with QR-code login (the user
scans a code in the Steam mobile app), stores the refresh token in the
OS keychain, and downloads the depot for Z1 Battle Royale (app
`433850` / depot `433851`, pinned to manifest `6098349229565958949`).

Everything runs **in-process in Rust** on a single Tokio runtime —
no Node child, no esbuild bundle, no `node_modules`, no
`DepotDownloader.exe`, no `steamcmd`. The implementation lives in
`src-tauri/src/depot.rs` and is a thin orchestrator on top of the
[`steamroom`](https://crates.io/crates/steamroom) +
[`steamroom-client`](https://crates.io/crates/steamroom-client) crates
(the cleanroom Rust reimplementations of SteamKit2 + DepotDownloader
that `steamroom-cli` ships as the official replacement for both).

### What `depot.rs` actually does

It does not implement the Steam protocol itself; it only wires
`steamroom` / `steamroom-client` calls into our Tauri event surface.
Concretely, every public function maps 1:1 to a phase of the canonical
SteamKit2 flow:

| Function              | SteamKit2 phase                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `login_qr(app)`       | `BeginAuthSessionViaQR` → render the challenge URL as a PNG data URL → poll until the user approves on phone → return `AuthTokens { refresh_token, access_token, account_name }`. |
| `download_depot`      | (skipping QR) reuse a stored refresh token, then run the full download pipeline below.                       |
| `drive_download`      | CM logon via `LoginBuilder::with_refresh_token(...).login()` → `get_depot_decryption_key` → `get_cdn_servers` → `get_manifest_request_code` → `get_cdn_auth_token` → `CdnClient::download_manifest_pooled` → `DepotManifest::parse` → `DepotJob::download` (concurrent chunk fetcher, CDN pool rotation, retry with backoff, SHA-1 verification, content-addressed reuse for delta updates, atomic file writes). |

`drive_download` is the function the user-visible "scan-and-go" entry
point ultimately invokes after the QR phase succeeds; it is also what
the `install_depot` (returning-user) path calls when a refresh token
is already in the keychain.

### Why `steamroom` is the right choice

| Concern                                | What `steamroom` gives us                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| QR auth                                | `LoginBuilder::new().with_qr().begin()` — uses Steam's OAuth-ish `BeginAuthSessionViaQR` proto, no `steam-auth-rs` HTTP detour, no `LoginSession::start_with_qr` console. |
| CM logon                               | `LoginBuilder::new().with_refresh_token(account, token).login()` — passes the QR-issued refresh token untouched to the CM logon message's `access_token` field. SteamKit2's documented pattern. No JWT signature rewriting, no `iss` claim forgery, no `LoginError(Invalid)` debugging session. |
| Manifest wire format                   | `DepotManifest::parse` handles both V4 (`0x71F617D0` payload, `0x1F4812BE` metadata) and V5 (`0x1B81B817` payload, `0x1F4DB10B` metadata, `0x1B81B813` signature, `0xD64BF064` end) on-wire layouts, including the magic-prefixed `<payload><metadata><signature><endmagic>` concatenated blobs. |
| CDN auth token                         | `client.get_cdn_auth_token(app, depot, host)` — the same service-method RPC Steam uses internally. Soft-fails (logs + continues without token) for depots that reject it, matching `steamroom-cli`'s behavior. |
| CDN server selection                   | `CdnServerPool` rotates across every server Steam returns on a failed request. Steam's directory often lists internal Valve hosts at the top of the load-sorted list that don't resolve publicly — picking the first one (which the old bridge did) deterministically 403'd. |
| Concurrent chunk download              | `CdnChunkFetcher` + `DepotJob` give concurrent HTTPS chunk pulls with retry-with-backoff, rate-limit-aware server cooldown, and SHA-1 verification of every assembled file. |
| Delta updates / resume                 | `DepotConfig` + content-addressed chunk reuse via `old_manifest_files` / `old_file_layouts`. A re-run only downloads changed chunks by content SHA, regardless of which file they live in. |
| Filename decryption                    | `manifest.decrypt_filenames(&depot_key)` — AES-256-ECB + AES-256-CBC over the depot key, for depots that ship with encrypted filenames. |

### Tauri event surface

The React wizard subscribes to the same event names it did before —
the rewrite preserves the IPC contract byte-for-byte:

| Event              | Payload                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `steam-qr`         | `string` — PNG data URL (`data:image/png;base64,…`) the wizard drops into an `<img src>`.        |
| `steam-scanned`    | `()` — user scanned the QR (Steam returned `pollAuthSessionStatus = Success`).                   |
| `steam-authed`     | `string` — public account name from the `AuthTokens`.                                            |
| `steam-error`      | `string` — error message; the wizard flips to a "retry" CTA.                                     |
| `depot-progress`   | `{ stage, message, bytesDone, bytesTotal, speedBps, etaSeconds }` — the wizard's progress card.  |
| `depot-done`       | `{ finalDir: string, bytes: number }` — terminal event; the wizard advances to the next step.   |
| `depot-error`      | `string` — same shape as `steam-error` but for the download phase.                               |

### Why not Node / SteamCMD / DepotDownloader

| Approach                              | Why we don't use it today                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **SteamCMD anonymous**                | Disallowed by Valve post-2022; the `+download_depot` path for app 433850 returns "missing app info".     |
| **`steamcmd.exe` + auth**             | Still requires the same Steam login flow the SteamKit crate gives us, plus it ships an extra binary.     |
| **DepotDownloader with `-qr`**        | The C# reference launcher's approach. Requires an interactive console to render the QR + drive SteamKit2's `InitializeSteam`; spawning it from a non-interactive Node child on Windows reliably fails with `AsyncJobFailedException` inside SteamKit2. We hit this in production. |
| **Node bridge (`steam-bridge.cjs`)**  | Required bundling SteamKit2 ports + ~100 MB of `node_modules` (lzma, protobufjs, @protobufjs/aspromise, etc.); one Node bump could break the externals. We deleted it. |
| **Custom SteamKit2 in Rust** (old)    | Wrote our own QR client, our own CM logon, our own JWT-claim rewriter, our own ZIP + magic-prefixed protobuf unwrapper, our own CDN auth token RPC, and our own per-file HTTPS downloader. Each step needed its own debug session because every failure mode was opaque to a library we'd have to debug too. We deleted it. |
| **`steamroom` / `steamroom-client`**  | One binary, no bundling hell, no env-var token leak, real `Result`-typed errors, and the protocol surface we get matches what the official `steamroom-cli` (the canonical DepotDownloader replacement) calls into. |

### Refresh-token storage

The refresh token never crosses an IPC boundary. `LoginBuilder::with_qr().begin()` returns it
in-process via `ApprovedAuth::tokens()`. We persist it to the OS keychain
with `tauri-plugin-keyring-store`
(`service: <bundle id>`, `account: "steam.refresh_token"`). The React
wizard only ever sees the public `accountName` via `steam_login_status`.

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
│       ├── debug_log.rs          # Rotating launch log file
│       ├── steam.rs              # Local Steam install detection (registry / paths)
│       ├── depot.rs              # Steam login + depot download (thin orchestrator over steamroom)
│       ├── launch_args.rs        # Steam launch arg builder (-condext, -novid, +app_id, ...)
│       └── wine.rs               # Wine registry for Linux launch
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
- `steam-qr` — string payload (data URL of the current QR PNG); fired once per QR refresh
- `steam-scanned` — unit payload; fired the moment Steam sees the user scan the code on their phone
- `steam-authed` — string payload (`account_name`); fired after the phone confirms the login
- `steam-error` — string payload; fatal Steam-side error (auth failure, manifest miss, etc.)
- `depot-progress` — `{ stage, message, bytesDone, bytesTotal, speedBps, etaSeconds }`; fired on every progress tick during the Steam download
- `depot-done` — `{ finalDir, bytes }`; fired when the depot finishes downloading successfully
- `depot-error` — string payload; fatal download error (CDN 404 after retries, disk write error, etc.)

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
