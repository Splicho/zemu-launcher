#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * release-build.cjs — one-shot release script for the ZEmu launcher.
 *
 * Usage:
 *   pnpm run release-build                        # interactive prompt
 *   pnpm run release-build -- v0.1.3              # explicit tag
 *   pnpm run release-build -- --tag=v0.1.3        # same, via flag
 *   pnpm run release-build -- --bump=patch        # auto-increment from
 *   pnpm run release-build -- --bump=minor        # current launcher version
 *   pnpm run release-build -- --bump=major        # (skips the prompt)
 *
 * What it does:
 *   1. Resolves the target tag (from arg / bump / prompt).
 *   2. Validates the working tree is clean (besides version files we'll touch).
 *   3. Bumps the version in:
 *        - package.json
 *        - src-tauri/Cargo.toml
 *        - src-tauri/tauri.conf.json
 *        - src/config/launcher.ts
 *   4. Commits as "chore(release): v<X.Y.Z>" and pushes to origin/main.
 *   5. Pushes the tag. The tag push alone triggers the release workflow
 *      (configured for `push: tags: 'v*'` in `.github/workflows/release.yml`)
 *      so we deliberately do NOT also dispatch the workflow manually —
 *      doing so starts a second, redundant run.
 *
 * Idempotent: if the version files already match the target, the commit
 * is skipped (but the tag push still happens).
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const rootDir = path.resolve(__dirname, '..')

const FILES = [
  { path: 'package.json', kind: 'json', versionKey: 'version' },
  { path: 'src-tauri/Cargo.toml', kind: 'toml', versionKey: 'version' },
  { path: 'src-tauri/tauri.conf.json', kind: 'json', versionKey: 'version' },
  { path: 'src/config/launcher.ts', kind: 'launcher-ts', versionKey: 'version' },
]

// ---------- tiny ANSI helpers (no dep) ----------
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

// ---------- args ----------
function parseArgs(argv) {
  const out = { tag: null, bump: null }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tag' || a === '-t') {
      out.tag = argv[++i]
    } else if (a.startsWith('--tag=')) {
      out.tag = a.slice('--tag='.length)
    } else if (a === '--bump' || a === '-b') {
      out.bump = argv[++i]
    } else if (a.startsWith('--bump=')) {
      out.bump = a.slice('--bump='.length)
    } else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    } else if (!a.startsWith('-')) {
      positional.push(a)
    } else {
      throw new Error(`Unknown flag: ${a}`)
    }
  }
  if (!out.tag && positional.length > 0) out.tag = positional[0]
  return out
}

function printHelp() {
  console.log(`Usage: pnpm run release-build [tag] [options]

Options:
  -t, --tag <vX.Y.Z>      Release tag (the "v" prefix is optional)
  -b, --bump <kind>       Auto-increment current version. <kind> is
                           "patch" | "minor" | "major" | "1.2.0".
                           (e.g. --bump=minor, --bump=0.2.0)
  -h, --help              Show this help

If neither --tag nor --bump is given, you'll be prompted. Just pressing
Enter increments the patch version.`)
}

// ---------- shell helpers ----------
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', cwd: rootDir, ...opts })
}
function runCapture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: rootDir, encoding: 'utf8', ...opts }).trim()
}
function runOrNull(cmd, args, opts = {}) {
  try {
    return runCapture(cmd, args, opts)
  } catch {
    return null
  }
}
function ensureCleanTree() {
  const status = runCapture('git', ['status', '--porcelain'])
  if (!status) return

  // Allow only files we're about to edit (or already-modified version files
  // + the lockfile that gets refreshed in step 5b).
  const allowed = new Set([
    ...FILES.map((f) => f.path.replace(/\\/g, '/')),
    'src-tauri/Cargo.lock',
  ])
  const offenders = status
    .split('\n')
    .map((l) => l.slice(3))
    .filter(Boolean)
    .filter((f) => !allowed.has(path.posix.normalize(f)))

  if (offenders.length > 0) {
    console.error(paint('red', '\nWorking tree has uncommitted changes:'))
    for (const f of offenders) console.error('  ' + f)
    console.error(
      paint(
        'yellow',
        '\nCommit or stash these before releasing. (Only the version files and Cargo.lock are touched by this script.)',
      ),
    )
    process.exit(1)
  }
}

// ---------- version helpers ----------
function isStrictSemver(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v)
}
function parseSemver(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3] }
}
function compareSemver(a, b) {
  const A = parseSemver(a)
  const B = parseSemver(b)
  if (!A || !B) throw new Error(`Not a semver: ${a} or ${b}`)
  if (A.major !== B.major) return A.major - B.major
  if (A.minor !== B.minor) return A.minor - B.minor
  return A.patch - B.patch
}
function bumpVersion(current, kind) {
  const cur = parseSemver(current)
  if (!cur) throw new Error(`Current version is not semver: ${current}`)
  switch (kind) {
    case 'patch':
      return `${cur.major}.${cur.minor}.${cur.patch + 1}`
    case 'minor':
      return `${cur.major}.${cur.minor + 1}.0`
    case 'major':
      return `${cur.major + 1}.0.0`
    default:
      // Allow passing an explicit version too: --bump=0.2.0
      if (isStrictSemver(kind)) return kind
      throw new Error(`Unknown bump kind: ${kind}`)
  }
}
function normalizeTag(input) {
  const stripped = input.replace(/^v/i, '').trim()
  if (!isStrictSemver(stripped)) {
    throw new Error(`Not a valid semver: "${input}" (expected e.g. "0.1.3" or "v0.1.3")`)
  }
  return `v${stripped}`
}

// ---------- file readers/writers ----------
function readVersion(file) {
  const abs = path.join(rootDir, file.path)
  const content = fs.readFileSync(abs, 'utf8')
  if (file.kind === 'json') {
    const data = JSON.parse(content)
    if (typeof data[file.versionKey] !== 'string') {
      throw new Error(`${file.path}: "${file.versionKey}" is not a string`)
    }
    return data[file.versionKey]
  }
  if (file.kind === 'toml') {
    // Cargo.toml: first `version = "X.Y.Z"` line under [package].
    const m = content.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)
    if (!m) throw new Error(`${file.path}: could not find [package] version = "..."`)
    return m[1]
  }
  if (file.kind === 'launcher-ts') {
    const m = content.match(/version\s*:\s*['"]([^'"]+)['"]/)
    if (!m) throw new Error(`${file.path}: could not find version: '...'`)
    return m[1]
  }
  throw new Error(`unknown file kind: ${file.kind}`)
}

function writeVersion(file, newVersion) {
  const abs = path.join(rootDir, file.path)
  const content = fs.readFileSync(abs, 'utf8')

  let next
  if (file.kind === 'json') {
    const data = JSON.parse(content)
    if (data[file.versionKey] === newVersion) return false
    data[file.versionKey] = newVersion
    next = JSON.stringify(data, null, 2) + '\n'
  } else if (file.kind === 'toml') {
    if (content.includes(`version = "${newVersion}"`)) return false
    next = content.replace(/^(\s*version\s*=\s*)"[^"]+"(\s*)$/m, `$1"${newVersion}"$2`)
  } else if (file.kind === 'launcher-ts') {
    if (content.includes(`version: '${newVersion}'`)) return false
    next = content.replace(/(version\s*:\s*)['"][^'"]+['"]/, `$1'${newVersion}'`)
  } else {
    throw new Error(`unknown file kind: ${file.kind}`)
  }

  fs.writeFileSync(abs, next, 'utf8')
  return true
}

// ---------- prompt ----------
function prompt(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const promptText = defaultValue
      ? `${question} ${paint('dim', `[${defaultValue}]`)}: `
      : `${question}: `
    rl.question(promptText, (answer) => {
      const trimmed = answer.trim()
      resolve(trimmed === '' ? defaultValue : trimmed)
    })
  })
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(paint('cyan', '\n  ZEmu release builder\n'))

  // 1. Determine current version from launcher.ts (canonical source).
  const current = readVersion(FILES.find((f) => f.kind === 'launcher-ts'))
  console.log(`  ${paint('dim', 'current version:')} ${paint('bold', current)}`)

  // 2. Resolve target tag.
  let rawTag = args.tag
  let bumpKind = args.bump
  if (!rawTag && !bumpKind) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      console.log('')
      console.log(`  Enter a release tag (e.g. ${paint('cyan', 'v0.1.3')} or ${paint('cyan', '0.1.3')}).`)
      console.log(
        `  Or pick a bump kind: ${paint('cyan', 'patch')} (default), ${paint(
          'cyan',
          'minor',
        )}, ${paint('cyan', 'major')}.`,
      )
      const answer = await prompt(rl, '  Tag / bump', 'patch')
      if (/^(patch|minor|major|\d+\.\d+\.\d+)$/i.test(answer)) {
        bumpKind = answer.toLowerCase()
      } else {
        rawTag = answer
      }
    } finally {
      rl.close()
    }
  }

  let target
  if (bumpKind) {
    target = bumpVersion(current, bumpKind)
  } else {
    target = normalizeTag(rawTag)
  }
  const strippedTarget = target.replace(/^v/, '')

  if (compareSemver(strippedTarget, current) <= 0) {
    console.error(
      paint(
        'red',
        `\nTarget ${target} is not newer than current ${current}. Refusing to release.`,
      ),
    )
    process.exit(1)
  }

  console.log(`  ${paint('dim', 'target version:')} ${paint('bold', paint('green', target))}\n`)

  // 3. Ensure clean tree.
  ensureCleanTree()

  // 4. Bump versions.
  let anyChanged = false
  for (const file of FILES) {
    const before = readVersion(file)
    if (before === strippedTarget) {
      console.log(`  ${paint('dim', '·')} ${file.path} ${paint('dim', '(unchanged)')}`)
      continue
    }
    const changed = writeVersion(file, strippedTarget)
    if (changed) {
      console.log(`  ${paint('yellow', '~')} ${file.path}  ${paint('dim', `${before} → ${strippedTarget}`)}`)
      anyChanged = true
    } else {
      console.log(`  ${paint('dim', '·')} ${file.path} ${paint('dim', '(already up to date)')}`)
    }
  }

  // 5. Commit if anything changed.
  if (anyChanged) {
    console.log('')
    console.log('  Committing version bump...')
    run('git', ['add', ...FILES.map((f) => f.path)])
    run('git', ['commit', '-m', `chore(release): ${target}`])
  } else {
    console.log(paint('dim', '\n  (no version changes to commit)'))
  }

  // 5b. Refresh Cargo.lock to match the bumped Cargo.toml.
  //     Without this, `cargo build --release --locked` (used by CI to
  //     warm the Rust cache and by `tauri-action` for the actual build)
  //     fails with "cannot update the lock file because --locked was
  //     passed". `cargo check --release` is enough to update the
  //     lockfile and is much faster than a full `cargo build`.
  console.log('')
  console.log('  Refreshing Cargo.lock...')
  try {
    run('cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml', '--release'])
    // If `cargo check` updated Cargo.lock, fold the change into the
    // version-bump commit so we ship a single self-consistent commit.
    const lockStatus = runCapture('git', ['status', '--porcelain', '--', 'src-tauri/Cargo.lock'])
    if (lockStatus) {
      run('git', ['add', 'src-tauri/Cargo.lock'])
      if (anyChanged) {
        run('git', ['commit', '--amend', '--no-edit'])
      } else {
        run('git', ['commit', '-m', `chore(release): refresh Cargo.lock for ${target}`])
      }
    }
  } catch (err) {
    console.warn(
      paint(
        'yellow',
        `  Warning: cargo check failed: ${err.message}\n` +
          '  Continuing without refreshing Cargo.lock. The CI/release build may fail with --locked.',
      ),
    )
  }

  // 6. Push main.
  console.log('')
  console.log('  Pushing main...')
  run('git', ['push', 'origin', 'main'])

  // 7. Push tag (delete-and-recreate to be idempotent on retry).
  //    The release workflow is configured to start on `push: tags: 'v*'`,
  //    so pushing the tag is what kicks off the build. Do NOT also
  //    `gh workflow run` it here — that starts a duplicate run.
  console.log('  Pushing tag...')
  const remoteTagExists = runOrNull('git', ['ls-remote', '--tags', 'origin', target])
  if (remoteTagExists) {
    run('git', ['push', 'origin', `:refs/tags/${target}`])
  }
  // Local tag may or may not exist; force-create it on HEAD.
  run('git', ['tag', '-f', target])
  run('git', ['push', 'origin', target])

  // 8. Print the URL of the tag-triggered run (the one we just started).
  console.log('')
  console.log(paint('green', `  ✓ Release ${target} triggered (via tag push).`))
  console.log(
    paint(
      'dim',
      `  Watch progress: gh run list --workflow=release.yml --limit 1\n`,
    ),
  )
}

main().catch((err) => {
  console.error(paint('red', `\n  Error: ${err.message}\n`))
  if (process.env.DEBUG) console.error(err.stack)
  process.exit(1)
})
