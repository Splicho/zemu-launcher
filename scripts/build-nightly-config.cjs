#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * build-nightly-config.cjs — writes the Tauri config override used for
 * nightly builds.
 *
 * The nightly workflow runs `pnpm tauri build --config
 * src-tauri/tauri.nightly.conf.json`, which JSON-merge-patches this file
 * on top of the canonical `src-tauri/tauri.conf.json` at build time. That
 * keeps the prod config untouched while still letting us ship nightly
 * installers with a distinct product name, identifier, version, and
 * deep-link scheme (so the nightly app installs side-by-side with prod
 * and never collides with it on the OAuth callback path).
 *
 * The file is a build artifact and is git-ignored — the workflow
 * regenerates it on every run.
 */

const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const launcherConfigPath = path.join(rootDir, 'src', 'config', 'launcher.ts')
const outConfigPath = path.join(rootDir, 'src-tauri', 'tauri.nightly.conf.json')

function readLauncherVersion() {
  const content = fs.readFileSync(launcherConfigPath, 'utf8')
  const m = content.match(/version\s*:\s*['"]([^'"]+)['"]/)
  if (!m) {
    throw new Error(
      `Could not read "version" from ${path.relative(rootDir, launcherConfigPath)}.`,
    )
  }
  return m[1].trim()
}

function assertSemver(version) {
  // Mirrors the strict semver check used in scripts/release-build.cjs.
  const re = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
  if (!re.test(version)) {
    throw new Error(`Launcher version "${version}" is not valid semver.`)
  }
}

function todayUtcYmd() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function main() {
  const launcherVersion = readLauncherVersion()
  assertSemver(launcherVersion)

  const date = todayUtcYmd()
  const nightlyVersion = `${launcherVersion}-nightly.${date}`

  const override = {
    productName: 'ZEmu Launcher Nightly',
    identifier: 'uk.zemu.launcher.nightly',
    version: nightlyVersion,
    bundle: {
      // Disable updater artifact signing — nightly builds don't have the
      // Tauri signing private key, so creating signed updater artifacts
      // would fail.
      createUpdaterArtifacts: false,
    },
    plugins: {
      // Override the updater so the nightly build never contacts the
      // production update endpoint. An empty pubkey prevents signing, and
      // an invalid/non-existent endpoint URL means the update check will
      // fail silently — the nightly app will never auto-upgrade to prod.
      updater: {
        pubkey: '',
        endpoints: ['https://nightly-ineligible.invalid'],
      },
      'deep-link': {
        desktop: {
          schemes: ['zemu-launcher-nightly'],
        },
      },
    },
  }

  fs.writeFileSync(outConfigPath, `${JSON.stringify(override, null, 2)}\n`, 'utf8')

  console.log(
    `[build-nightly-config] wrote ${path.relative(
      rootDir,
      outConfigPath,
    )} (productName="${override.productName}", identifier="${override.identifier}", version="${override.version}")`,
  )
}

try {
  main()
} catch (err) {
  console.error(
    `[build-nightly-config] ${err instanceof Error ? err.message : String(err)}`,
  )
  process.exit(1)
}
