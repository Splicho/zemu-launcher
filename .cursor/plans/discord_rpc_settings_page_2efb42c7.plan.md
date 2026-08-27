---
name: Discord RPC settings page
overview: Replace the placeholder Discord client ID, add a user-facing on/off toggle (persisted), and surface a dedicated /settings page reachable from the sidebar so users can disable Discord Rich Presence.
todos:
  - id: set-client-id
    content: Replace Discord client ID constant in src-tauri/src/discord.rs
    status: completed
  - id: config-field
    content: Add discord_rpc_enabled field to LauncherConfig in src-tauri/src/models.rs
    status: completed
  - id: commands
    content: Add discord_get_enabled / discord_set_enabled commands in src-tauri/src/commands.rs and register them
    status: completed
  - id: worker-loop-guard
    content: Honor the toggle inside worker_loop in src-tauri/src/discord.rs
    status: completed
  - id: bridge-extend
    content: Extend window.discordAPI in src/lib/tauri-bridge.ts with getEnabled / setEnabled
    status: completed
  - id: settings-page
    content: Create src/pages/settings.tsx with a Discord toggle section
    status: completed
  - id: route-handler
    content: Add /settings route handling in src/main-app.tsx
    status: completed
  - id: sidebar-entry
    content: Add Settings link to the sidebar in src/components/app-sidebar.tsx
    status: completed
  - id: verify
    content: Run the project, toggle on/off, confirm presence behavior in debug log
    status: completed
isProject: false
---

Discord Rich Presence is already wired in Rust (`src-tauri/src/discord.rs`, `commands.rs`) and the bridge (`src/lib/tauri-bridge.ts` exposes `window.discordAPI`). What's missing is (1) a real client ID, (2) a user-facing on/off toggle, and (3) a route/UI for it.

## 1. Set the real Discord application client ID

**File:** `src-tauri/src/discord.rs` (line 12)

Replace the placeholder constant:

```rust
const DISCORD_CLIENT_ID: &str = "1542061186600804352";
```

That's all that's needed for IPC connection to work. (Discord assets for `large_image`/`large_text` keys — `launcher`, `game` — must be uploaded to that Discord app's Rich Presence Art Assets, or they fall back to Discord's default. Out of scope for code, but worth flagging to the user.)

## 2. Persist the toggle in `LauncherConfig`

**File:** `src-tauri/src/models.rs` (around lines 67–100)

Add a new field with a sensible default of `true` (opt-out, not opt-in, to match the current behaviour):

```rust
pub struct LauncherConfig {
    // ... existing fields ...
    #[serde(default = "default_true")]
    pub discord_rpc_enabled: bool,
}
```

And extend the `Default` impl + `default_true` helper (which already exists).

The existing `storage::load_launcher_config` / `save_launcher_config` handle persistence automatically — no new file paths needed.

## 3. Add Rust commands for the toggle

**File:** `src-tauri/src/commands.rs`

Add three commands next to the existing `discord_set_in_launcher` / `discord_set_activity` (around lines 274–286):

```rust
#[tauri::command]
pub fn discord_get_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    storage::load_launcher_config(&app)
        .map(|c| c.discord_rpc_enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discord_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = storage::load_launcher_config(&app).map_err(|e| e.to_string())?;
    config.discord_rpc_enabled = enabled;
    storage::save_launcher_config(&app, &config).map_err(|e| e.to_string())
}
```

Register them in `register_commands()` next to `discord_set_in_launcher` / `discord_set_activity` (around line 416–417).

## 4. Make `discord.rs` honor the toggle on every send

**File:** `src-tauri/src/discord.rs`

Wrap the worker loop so a single config check short-circuits every command. The cheapest place is at the top of `worker_loop` — read the config on each `recv_timeout` tick and again whenever `apply_activity` runs:

```rust
fn is_enabled(app: &AppHandle) -> bool {
    crate::storage::load_launcher_config(app)
        .map(|c| c.discord_rpc_enabled)
        .unwrap_or(true)
}
```

Then in each `Ok(DiscordCommand::SetLauncher | SetInGame | SetActivity)` arm and on the timeout retry, early-return if `!is_enabled(&app)`. This avoids touching the network and naturally disconnects any active client on next tick.

The existing `set_in_launcher` / `set_in_game` callers (`game.rs` on launch/exit, `lib.rs` on startup) keep working — they just no-op when the user has opted out.

## 5. Extend the renderer bridge

**File:** `src/lib/tauri-bridge.ts` (around lines 209–224, plus the `Window` declaration around line 332)

Extend `window.discordAPI`:

```ts
discordAPI: {
  setInLauncher: () => void
  setActivity: (details: string, state: string) => void
  getEnabled: () => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<void>
}
```

Mirror the existing wrapper style (`void invoke(...).catch(writeDebugLog('discord', ...))`).

## 6. Add a dedicated `/settings` page

Routing today uses `window.location.hash` parsed in `src/main-app.tsx::parseRoute` (lines 23–33) — not `react-router`. Follow the same pattern.

**New file:** `src/pages/settings.tsx`

Exports `SettingsPage` — a single-column layout with a Discord section containing:
- A `Switch` (already used elsewhere via `@/components/ui/switch`) bound to local state, initialised from `window.discordAPI.getEnabled()`.
- An on-change handler that calls `window.discordAPI.setEnabled(next)` and persists.
- A short explanatory paragraph ("Show your friends what you're playing. Requires Discord to be running.").
- A small "Status: enabled/disabled" pill driven by the local state, so the user gets immediate visual feedback.

Mirror the page-header pattern from `src/pages/play.tsx` / `home.tsx` so it sits naturally inside `<MainLayout>`.

**File:** `src/main-app.tsx` (lines 23–33 and 149–152)

- Add `if (hash === '/settings') return { page: 'settings' }` in `parseRoute`.
- Add `{route.page === 'settings' && <SettingsPage />}` in the `AuthedApp` render.

## 7. Add sidebar entry

**File:** `src/components/app-sidebar.tsx`

Add a `Settings` `SidebarMenuButton` in the existing "Menu" group (around lines 215–234), pointing at `#/settings`, using the existing `isActive('/settings')` highlight rule. Re-use the `Settings` icon already imported (line 2).

## 8. Wire title-bar height parity

**File:** `src/components/main-layout.tsx`

No change needed — `SettingsPage` is rendered inside `<MainLayout>` like every other page.

## Verification

- `npm run tauri dev` (or whatever the project's dev script is — check `package.json`).
- With Discord running, launch the game: the "Playing" presence should appear.
- Toggle off in `/settings`, restart the game: no presence, and `set_in_launcher` is a no-op.
- Toggle back on: presence resumes on next launch.
- Check the debug log (`debug_log_read` / the file under app data) — `discord` source lines confirm the commands are enqueued but skipped when disabled.

## Out of scope

- Custom Discord `details` / `state` text from the UI (the bridge methods exist but no UI calls them yet — can be a follow-up).
- Discord asset upload to the developer portal (needs the user to drag-and-drop `launcher.png` / `game.png` into the Discord app's Rich Presence Art Assets).
- OAuth-linked Discord identity (the `LicenseRecord.discord_user_id` field exists but is unused).