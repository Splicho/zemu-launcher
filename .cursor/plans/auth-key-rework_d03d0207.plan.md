---
name: auth-key-rework
overview: Rework the ZEmu Launcher licensing system to replace the server-validated license key flow with a simple local auth key stored in the launcher config. No server validation. The auth key is stored locally and passed directly to H1Z1.exe as the SessionId at launch.
todos:
  - id: add-auth-key-config
    content: Add auth_key field to LauncherConfig (Rust models.rs)
    status: completed
  - id: add-auth-key-commands
    content: Add launcher_get_auth_key / launcher_set_auth_key IPC commands (Rust commands.rs)
    status: completed
  - id: update-launch-game
    content: Update game.rs launch_game to read auth_key and write to ClientConfig.ini
    status: completed
  - id: add-bridge-auth-key
    content: Add getAuthKey / setAuthKey to window.launcherAPI (tauri-bridge.ts)
    status: completed
  - id: create-auth-key-modal
    content: Create AuthKeyModal component (src/components/auth-key-modal.tsx)
    status: completed
  - id: update-game-action-button
    content: "Update game-action-button.tsx: replace LICENSE_REQUIRED with auth key modal trigger"
    status: completed
  - id: strip-license-gate
    content: Strip license gate from use-game-state.ts and game-state-context.tsx
    status: completed
  - id: add-translations
    content: Add auth key translations to all locale files
    status: completed
  - id: delete-license-files
    content: Delete old license files (use-license.ts, license-context.tsx, license.ts, properties-license-section.tsx)
    status: completed
isProject: false
---

## Plan: Auth Key Rework

### Overview

The current system uses a server-validated 20-char license key (Crockford base32) with bind-on-first-use, periodic revalidation, and a fetch-from-keys-endpoint session id. This is replaced by:

- **Auth key**: freeform string, stored locally in `launcher-config.json`, never validated against a server
- **Play launch**: reads the stored auth key and passes it as `SessionId=` in `ClientConfig.ini` (replacing the network-fetched session id)
- **No license gate**: the game can always be launched once an auth key is saved; no server validation of key activity

---

### Changes by file

#### Rust (`src-tauri/src/`)

**[`models.rs`](src-tauri/src/models.rs)**
- Add `auth_key: Option<String>` to `LauncherConfig`. Persisted alongside all other config fields.

**[`commands.rs`](src-tauri/src/commands.rs)**
- Add `launcher_get_auth_key(app) -> Option<String>` — reads from `LauncherConfig`
- Add `launcher_set_auth_key(app, key) -> ()` — writes to `LauncherConfig`
- Register both in `register_commands()`
- Keep old license commands (`license_get_record`, `license_save_record`, etc.) in place — not actively called from the frontend any more but harmless to leave

**[`game.rs`](src-tauri/src/game.rs)**
- In `launch_game()`: replace the `session_id::prepare_client_config(..., false)` call with a local auth-key read:
  1. Load `LauncherConfig`
  2. Read `auth_key`
  3. If present, call `session_id::write_session_id_to_client_config(game_directory, &auth_key)`
  4. If absent, skip writing (no error — launcher won't launch if no auth key is set)
- Remove the `session_id::prepare_client_config` call entirely

**[`session_id.rs`](src-tauri/src/session_id.rs)**
- No changes to `write_session_id_to_client_config` — it already writes any arbitrary string as `SessionId=`
- `prepare_client_config` is no longer called from `game.rs`; leave it in place for now (unused but tested)

---

#### Frontend (`src/`)

**[`hooks/use-game-state.ts`](src/hooks/use-game-state.ts)**
- Remove the `LICENSE_REQUIRED` / `LICENSE_BINDING` state types from `GameState` union
- Remove the `licenseStatus` parameter from `useGameState()` — no longer needed as a gate
- Remove the license gate overlay in the `state` memo (`baseState` flows straight through; no more `licenseStatus` short-circuit)
- Remove the `isApplyingPatch` state and related calls (patch application was tied to license gate — verify if still needed)
- Update call sites that pass `licenseStatus` — see `GameStateProvider` in `game-state-context.tsx`

**[`contexts/game-state-context.tsx`](src/contexts/game-state-context.tsx)**
- Remove `licenseStatus` prop from `GameStateProvider` props
- Remove the `LicenseStatus` import
- Pass an empty/always-satisfied license status to `useGameState`

**[`components/game-action-button.tsx`](src/components/game-action-button.tsx)**
- Change the `LICENSE_REQUIRED` case in `buttonText` to use `t('play.authKeyRequired')` (text: "Auth Key Required")
- In `handlePrimaryAction`: replace the `openProperties('license')` redirect with `setShowAuthKeyModal(true)`
- Add `const [showAuthKeyModal, setShowAuthKeyModal] = useState(false)`
- Import and render `<AuthKeyModal open={showAuthKeyModal} onOpenChange={setShowAuthKeyModal} onSaved={...} />`
- Add `onSaved` callback that re-derives state (no more license gate, so just re-renders)
- Remove `usePropertiesModalOpener` import and usage (`openProperties`)
- Remove the `useGameStateContext` `openProperties` destructuring

**New file: [`components/auth-key-modal.tsx`](src/components/auth-key-modal.tsx)**
- Standalone modal (not part of Properties) — simple, focused UX
- Props: `open`, `onOpenChange`, `onSaved: () => void`
- Body: `Input` for freeform auth key, `save` button
- On save: calls `window.launcherAPI.setAuthKey(value)`, fires `onSaved()`, closes modal
- No validation, no formatting — accepts any non-empty string
- Shows current saved key (masked) if one exists

**New file: [`lib/tauri-bridge-auth-key.ts`](src/lib/tauri-bridge-auth-key.ts) (or merged into existing bridge — see below)**
- Add to `window.launcherAPI` in `tauri-bridge.ts`:
  - `getAuthKey: () => Promise<string | null>`
  - `setAuthKey: (key: string) => Promise<void>`

**[`lib/tauri-bridge.ts`](src/lib/tauri-bridge.ts)**
- Add `getAuthKey` and `setAuthKey` to `window.launcherAPI` interface and the bridge implementation
- Update `Window.launcherAPI` type declaration to include new fields

**[`locales/en.ts`](src/locales/en.ts) + all locale files**
- Add `play.authKeyRequired: 'Auth Key Required'`
- Update `play.accountKeyRequired` (keep for migration reference or remove if unused)
- Add `authKey.modalTitle`, `authKey.inputLabel`, `authKey.save`, `authKey.currentKey` entries

---

### Deletions (remove from git)

- `src/components/properties-license-section.tsx` — replaced by `AuthKeyModal`
- `src/components/properties-section.tsx` — strip the `license` branch in the section switch (or keep it pointing to a stub)
- `src/hooks/use-license.ts` — entire file
- `src/contexts/license-context.tsx` — entire file
- `src/lib/license.ts` — entire file (license HTTP calls + formatting utils)
- Remove `LicenseSection` import from `properties-section.tsx` (keep the file, strip the license branch)

---

### Migration note

The old `LicenseRecord` disk file (`app_data/license-store.json`) is no longer read. The file can be left on disk — it will simply be ignored. The old `LICENSE_REQUIRED` / `LICENSE_BINDING` states in `GameState` are removed entirely so the type shrinks.