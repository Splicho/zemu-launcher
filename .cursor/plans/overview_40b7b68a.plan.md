---
name: Overview
overview: Add a GitHub Actions nightly workflow that builds ZEmu Launcher with `icon-nightly.png`, a separate identifier (`uk.zemu.launcher.nightly`), and date-suffixed versions. Installers are attached to the workflow run as artifacts — no GitHub Release, no publishing to `zemu-launcher-releases`. Production pipeline stays untouched. A small `scripts/trigger-nightly.cjs` plus a `package.json` script lets you fire the nightly manually with `pnpm nightly:trigger`.
todos:
  - id: create-build-nightly-config-script
    content: Create scripts/build-nightly-config.cjs that writes src-tauri/tauri.nightly.conf.json with productName/identifier/version overrides and today's date suffix
    status: pending
  - id: create-nightly-workflow
    content: Create .github/workflows/nightly.yml with schedule + workflow_dispatch triggers, Windows/Linux matrix, icon regeneration from icon-nightly.png, tauri build --config src-tauri/tauri.nightly.conf.json, and actions/upload-artifact for the installers
    status: pending
  - id: create-trigger-nightly-script
    content: Create scripts/trigger-nightly.cjs that invokes `gh workflow run nightly.yml --ref main` and prints the run URL (and a ready-to-paste `gh run watch` command) — mirroring the style of scripts/release-build.cjs
    status: pending
  - id: add-package-json-script
    content: "Add `\"nightly:trigger\": \"node scripts/trigger-nightly.cjs\"` to package.json scripts block (no other changes)"
    status: pending
  - id: commit-icon-nightly
    content: Confirm icon-nightly.png exists in the repo root (commit it if missing)
    status: pending
  - id: optional-deeplink-override
    content: Optionally override the deep-link scheme to `zemu-launcher-nightly` in tauri.nightly.conf.json so nightly OAuth / deep-link tests are fully isolated from prod
    status: pending
isProject: false
---

## Overview

Add a separate GitHub Actions workflow (`.github/workflows/nightly.yml`) that builds a nightly "ZEmu Launcher Nightly" build with its own identifier (`uk.zemu.launcher.nightly`), its own icons (from `icon-nightly.png`), and a date-suffixed version. Installers are attached to the workflow run as artifacts — no GitHub Release, no push to `Splicho/zemu-launcher-releases`, and no changes to the existing `release.yml` pipeline.

Add `scripts/trigger-nightly.cjs` plus a `package.json` script entry so `pnpm nightly:trigger` fires the workflow manually and prints the run URL — mirroring the ergonomics of `pnpm release-build`.

Tauri 2 supports a `--config` flag that JSON-merge-patches a partial config on top of the base `tauri.conf.json` at build time. We use that to override just `productName`, `identifier`, and `version` without mutating the canonical config.

## Files to create

- **NEW** `.github/workflows/nightly.yml` — the nightly workflow
- **NEW** `scripts/build-nightly-config.cjs` — writes the nightly override config
- **NEW** `scripts/trigger-nightly.cjs` — fires the nightly workflow via `gh workflow run` and prints the run URL

## Files to modify

- **MODIFY** `package.json` — add the `"nightly:trigger"` script entry

## `.github/workflows/nightly.yml`

- Triggers:
  - `schedule.cron: '0 3 * * *'` — 03:00 UTC every day
  - `workflow_dispatch` — manual "Run workflow" from the Actions tab
- Permissions: `contents: read` (no write needed)
- Matrix on `windows-latest` and `ubuntu-latest`, same bundle types as prod (`nsis` / `deb,appimage`)
- Separate Rust cache key per platform (e.g. `nightly-windows-x64`, `nightly-linux-x64`) so it doesn't evict the prod cache
- Per-job steps:
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4`, `actions/setup-node@v4` (Node 20, pnpm cache)
  3. `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2` with the nightly cache key
  4. Linux apt-get list — identical to `release.yml` (libwebkit2gtk-4.1-dev, etc.)
  5. `pnpm install --frozen-lockfile`
  6. `pnpm run sync:launcher-config` — keeps the canonical `tauri.conf.json` consistent (we read from it, but don't write to it)
  7. `node scripts/build-nightly-config.cjs` — generates `src-tauri/tauri.nightly.conf.json` with today's date
  8. **Regenerate icons from `icon-nightly.png`:**
     - `pnpm tauri icon icon-nightly.png --output src-tauri/icons` (cross-platform — replaces all five `icons/*` files the bundler reads)
     - Copy `src-tauri/icons/icon.ico` to `assets/icon/app-icon.ico` (NSIS installer icon)
  9. `pnpm tauri build --config src-tauri/tauri.nightly.conf.json --bundles <matrix.bundles>`
  10. `actions/upload-artifact@v4` with the resulting `.exe` / `.deb` / `.AppImage` files

## `scripts/build-nightly-config.cjs`

- Reads the current launcher version from `src/config/launcher.ts` (same approach `scripts/sync-launcher-config.cjs` uses)
- Computes today's UTC date as `YYYYMMDD`
- Writes `src-tauri/tauri.nightly.conf.json` with:

```json
{
  "productName": "ZEmu Launcher Nightly",
  "identifier": "uk.zemu.launcher.nightly",
  "version": "<launcherVersion>-nightly.<YYYYMMDD>"
}
```

Tauri JSON-merge-patches this on top of `src-tauri/tauri.conf.json` at build time. Example resolved output: `productName="ZEmu Launcher Nightly"`, `identifier="uk.zemu.launcher.nightly"`, `version="0.1.28-nightly.20260908"`.

## `scripts/trigger-nightly.cjs`

A small Node.js script that mirrors the style of `scripts/release-build.cjs`:

- Verifies `gh` is on PATH (clear error + install hint if not).
- Runs `gh workflow run nightly.yml --ref main` via `execFileSync` (no shell, no quoting issues).
- Polls `gh run list --workflow=nightly.yml --limit 1 --json databaseId,url,status,conclusion` until the run appears (the CLI returns the run URL immediately, but the first `gh run list` call right after `gh workflow run` can race by a second or two).
- Prints a single line with the run URL plus a copy-pasteable `gh run watch` command, similar to the closing log of `release-build.cjs`.

Example output:

```
$ pnpm nightly:trigger
  nightly run triggered.
  Watch: https://github.com/Splicho/zemu-launcher/actions/runs/1234567890
  Or:   gh run watch 1234567890 --exit-status
```

## `package.json` change

Add a single entry to the `scripts` block:

```json
"nightly:trigger": "node scripts/trigger-nightly.cjs"
```

Production scripts (`build`, `release-build`, `dev`, `sync:launcher-config`, etc.) are untouched.

## How beta testers get builds

1. Open the **Actions** tab of this repo.
2. Pick the **Nightly Build** workflow on the left.
3. Click the latest successful run.
4. Scroll to **Artifacts** and download `zemu-launcher-nightly-windows-x64` (NSIS installer) or `zemu-launcher-nightly-linux-x64` (`.deb` / `.AppImage`).

Installer retention: 14 days (long enough for typical weekly testing cycles).

## Notes / caveats

- `icon-nightly.png` must be committed to the repo root before the workflow runs (it's referenced as `icon-nightly.png` in the `pnpm tauri icon` step).
- Because we don't call `tauri-action` with `includeUpdaterJson`, no `latest.json` is generated, so the prod updater channel stays clean. The nightly app's built-in updater will hit the prod endpoint and get a 404 / no-update response — expected and safe.
- The existing deep-link scheme (`zemu-launcher`) is **not** overridden. If you want nightly OAuth / deep-link tests to be fully isolated too, add this to `tauri.nightly.conf.json`:
  ```json
  "plugins": { "deep-link": { "desktop": { "schemes": ["zemu-launcher-nightly"] } } }
  ```
- The nightly identifier is `uk.zemu.launcher.nightly`, so it installs side-by-side with the prod app. App data (`%AppData%\uk.zemu.launcher` vs `%AppData%\uk.zemu.launcher.nightly`) is also isolated.
- `pnpm nightly:trigger` requires `gh` CLI on PATH and an authenticated session (`gh auth status`). The script checks both and prints actionable errors if either is missing.