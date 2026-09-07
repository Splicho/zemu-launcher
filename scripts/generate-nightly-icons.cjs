#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * generate-nightly-icons.cjs — builds the Tauri's `src-tauri/icons/*`
 * set from `icon-nightly.png`, and keeps the NSIS installer icon in
 * `assets/icon/app-icon.ico` in sync on Windows.
 *
 * Used by `.github/workflows/nightly.yml`. Tauri's `pnpm tauri icon`
 * command pads the source PNG onto a square canvas automatically and
 * produces every variant (32x32, 128x128, 128x128@2x, .ico, .icns), so
 * the previous PowerShell squaring step from
 * `scripts/generate-tauri-icons.ps1` isn't needed here.
 *
 * Mirrors the exit-0-on-missing-input behavior of the prod script so a
 * missing `icon-nightly.png` (e.g. a one-off local run with a custom
 * checkout) doesn't break the workflow.
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const sourceIcon = path.join(rootDir, 'icon-nightly.png')
const iconsDir = path.join(rootDir, 'src-tauri', 'icons')
const uiIcoPath = path.join(rootDir, 'assets', 'icon', 'app-icon.ico')

function rel(p) {
  return path.relative(rootDir, p)
}

function main() {
  if (!fs.existsSync(sourceIcon)) {
    console.log(
      `[generate-nightly-icons] no ${rel(sourceIcon)} — skipping icon generation.`,
    )
    process.exit(0)
  }

  // Tauri's `icon` command accepts a non-square source and handles
  // centering on a transparent canvas. It produces the full set of
  // icons the bundler reads from `src-tauri/icons/*`.
  execFileSync(
    'pnpm',
    [
      'tauri',
      'icon',
      rel(sourceIcon),
      '--output',
      rel(iconsDir),
    ],
    { stdio: 'inherit', cwd: rootDir },
  )

  // Tauri's icon command generates `icon.ico` on every platform as
  // part of its standard output set. NSIS reads
  // `bundle.windows.nsis.installerIcon` (configured in tauri.conf.json
  // to `../assets/icon/app-icon.ico`) at install time, so mirror the
  // generated ICO into that path on Windows. Skipping this on
  // non-Windows runners avoids touching an installer-only asset from a
  // platform that can't actually consume it.
  if (process.platform === 'win32') {
    const generatedIco = path.join(iconsDir, 'icon.ico')
    if (fs.existsSync(generatedIco)) {
      fs.mkdirSync(path.dirname(uiIcoPath), { recursive: true })
      fs.copyFileSync(generatedIco, uiIcoPath)
      console.log(
        `[generate-nightly-icons] synced NSIS installer icon: ${rel(uiIcoPath)}`,
      )
    }
  }
}

try {
  main()
} catch (err) {
  console.error(
    `[generate-nightly-icons] ${err instanceof Error ? err.message : String(err)}`,
  )
  process.exit(1)
}
