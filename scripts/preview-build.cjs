#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * preview-build.cjs — fires the preview-build workflow via the `gh` CLI.
 *
 * Usage:
 *   pnpm run preview-build
 *   node scripts/preview-build.cjs
 *
 * What it does:
 *   1. Verifies `gh` is installed and authenticated.
 *   2. Runs `gh workflow run preview-build.yml --ref main` to dispatch.
 *   3. Polls `gh run list --workflow=preview-build.yml` for the run URL
 *      (the CLI returns immediately, but the run can take a second or
 *       two to appear in the list).
 *   4. Prints the URL and a copy-pasteable `gh run watch` command.
 *
 * This is the preview-build analogue of `release-build`: same shape, but
 * there is no version to bump and no tag to push — preview-build just
 * uploads installers as workflow artifacts. It is intentionally a pure
 * dispatch trigger and does NOT touch git.
 */

const { execFileSync, spawnSync } = require('node:child_process')

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined
const paint = (color, s) => (useColor ? c[color](s) : s)

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

function runCapture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim()
}

// Use spawnSync (not execFileSync) for the auth/version probes so a
// missing binary surfaces as status=null instead of throwing ENOENT,
// letting us emit a friendly error message.
function runStatus(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureGhInstalled() {
  const r = runStatus('gh', ['--version'])
  if (r.status === null) {
    console.error(paint('red', '\n  gh CLI not found on PATH.'))
    console.error(
      paint('dim', '  Install it from https://cli.github.com/ and run `gh auth login`.'),
    )
    process.exit(1)
  }
}

function ensureGhAuthenticated() {
  const r = runStatus('gh', ['auth', 'status'])
  if (r.status !== 0) {
    console.error(paint('red', '\n  gh CLI is not authenticated.'))
    console.error(paint('dim', '  Run `gh auth login` (or set GH_TOKEN) and try again.'))
    if (r.stderr) console.error(paint('dim', `\n${r.stderr.trim()}`))
    process.exit(1)
  }
}

function dispatchWorkflow() {
  // `--ref main` is hard-coded so we never accidentally dispatch against
  // a feature branch that's been pushed but not merged.
  run('gh', ['workflow', 'run', 'preview-build.yml', '--ref', 'main'])
}

async function resolveRun({ attempts = 10, delayMs = 1500 } = {}) {
  // `gh workflow run` returns immediately with no stdout. The new run
  // usually appears in `gh run list` within ~1s, but we retry briefly
  // to absorb that race.
  for (let i = 0; i < attempts; i++) {
    let parsed = []
    try {
      const json = runCapture('gh', [
        'run',
        'list',
        '--workflow=preview-build.yml',
        '--limit=1',
        '--json=databaseId,url,status,displayTitle,createdAt',
      ])
      parsed = JSON.parse(json)
    } catch {
      parsed = []
    }
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].url) {
      return parsed[0]
    }
    await sleep(delayMs)
  }
  return null
}

async function main() {
  console.log(paint('cyan', '\n  ZEmu preview-build trigger\n'))

  ensureGhInstalled()
  ensureGhAuthenticated()

  console.log('  Dispatching preview-build workflow...')
  dispatchWorkflow()

  const run = await resolveRun()
  if (!run) {
    console.error(
      paint(
        'yellow',
        '\n  Dispatched, but could not resolve the run URL after a few retries.',
      ),
    )
    console.error(
      paint('dim', '  Check `gh run list --workflow=preview-build.yml --limit 1` to see it.'),
    )
    process.exit(0)
  }

  console.log('')
  if (run.displayTitle) {
    console.log(paint('green', `  Preview build triggered: ${run.displayTitle}`))
    console.log('')
  }
  console.log(`  ${paint('dim', 'Watch:')} ${paint('bold', run.url)}`)
  console.log(
    `  ${paint('dim', 'CLI:  ')} ${paint('bold', `gh run watch ${run.databaseId} --exit-status`)}`,
  )
  console.log('')
}

main().catch((err) => {
  console.error(paint('red', `\n  Error: ${err.message}`))
  if (process.env.DEBUG) console.error(err.stack)
  process.exit(1)
})
