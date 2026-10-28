/**
 * `vite build` with an isolated esbuild temp directory.
 *
 * Why this wrapper exists: esbuild copies its service binary into
 * `os.tmpdir()` (`%LOCALAPPDATA%\Temp` on Windows) using a hash of the
 * esbuild version as the filename, then deletes it on exit. Because the
 * name is shared, a second esbuild process — a running `npm run dev` /
 * `tauri dev`, or a leftover service from a crashed build — keeps that file
 * open, and the next build fails with:
 *
 *   [vite:esbuild-transpile] remove ...\Temp\esbuild-<hash>: Access is denied.
 *
 * Pointing TMP/TEMP at a repo-local directory before Vite (and therefore
 * esbuild) is loaded gives the build its own temp space, so a dev server can
 * stay running while you package. The directory is gitignored.
 */

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp-esbuild')

mkdirSync(tempDir, { recursive: true })

// Must be set before `vite` is imported: esbuild resolves `os.tmpdir()` from
// these variables when its module initialises.
process.env.TMP = tempDir
process.env.TEMP = tempDir

const { build } = await import('vite')

try {
  await build()
} catch (error) {
  console.error(error)
  process.exit(1)
}
