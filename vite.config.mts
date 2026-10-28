import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs'

// Read version from package.json so the frontend can render it without
// hitting the Tauri backend.
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))

function copyRecursive(src: string, dest: string) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }

  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

// Copies anything under ./assets (backgrounds, icons, ...) into
// the production bundle so the Tauri resource bundler can pick it up.
const copyAssetsPlugin = () => {
  return {
    name: 'copy-assets',
    writeBundle() {
      const assetsSrc = path.resolve(__dirname, 'assets')
      const assetsDest = path.resolve(__dirname, 'dist', 'assets')

      if (existsSync(assetsSrc)) {
        copyRecursive(assetsSrc, assetsDest)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), copyAssetsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  server: {
    port: 5173,
    // Vite's default watcher walks the whole project root, so it picks
    // up the dll/pdb files cargo produces in `src-tauri/target/`. Those
    // files are held open by the running Tauri process on Windows and
    // the watcher dies with EBUSY. Restricting the watcher to the
    // frontend tree keeps Vite responsive and avoids the spurious
    // crashes when the Rust side is mid-rebuild.
    //
    // The `.tmpdir` / `.tmp` patterns cover editor and tooling
    // atomic-save staging: some writers stage a file as
    // `<dir>/.<name>.<pid>.<uuid>.tmpdir/<name>.tmp` next to the
    // target and rename it into place. Chokidar tries to attach to the
    // staged copy while the writer still holds it and dies with the
    // same EBUSY, which kills the dev server (and therefore
    // `tauri dev`) on every save. Ignoring the staging paths keeps the
    // watcher alive through edits.
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/src-tauri/Cargo.lock',
        '**/.git/**',
        '**/*.tmpdir',
        '**/*.tmpdir/**',
        '**/*.tmp',
      ],
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
  },
  build: {
    minify: 'esbuild',
    rollupOptions: {
      output: {
        /**
         * One chunk for (almost) all of `node_modules`.
         *
         * Splitting npm packages into several chunks is what broke the
         * packaged build: `vendor` imported `ui-vendor`, `ui-vendor` imported
         * `react-vendor`, and `react-vendor` imported `vendor` again. That
         * three-way cycle is harmless inside one file, but across chunk
         * boundaries Rollup emits top-level imports that evaluate in the wrong
         * order, so React itself was `undefined` when a module called
         * `createContext` — a blank window with no UI at all.
         *
         * Keeping everything but the Tauri API in a single chunk removes every
         * cross-chunk cycle by construction. Rollup then orders the modules
         * inside that file correctly. The trade-off is one larger vendor file,
         * which is fine for a desktop app loading from disk.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('@tauri-apps')) {
            return 'tauri-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
})
