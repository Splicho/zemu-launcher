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
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/src-tauri/Cargo.lock',
        '**/.git/**',
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
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          // Put React + ReactDOM + scheduler in the same chunk so the
          // runtime can resolve circular imports between react-dom
          // (consumer) and react (dependency) without hitting a
          // TDZ/undefined-reference error at module-eval time.
          if (
            id.includes(`${path.sep}react${path.sep}`) ||
            id.includes(`${path.sep}react-dom${path.sep}`) ||
            id.includes(`${path.sep}scheduler${path.sep}`)
          ) {
            return 'react-vendor'
          }

          if (
            id.includes('react-router') ||
            id.includes('@tanstack/react-query') ||
            id.includes('@tanstack/query-core') ||
            id.includes('@floating-ui')
          ) {
            // Folding react-router / react-query and their shared
            // React-adjacent dependencies into the react-vendor chunk
            // eliminates a real cross-chunk import cycle that crashed
            // the Linux Chromium build at module-eval time.
            // The cyclic edge looked like:
            //
            //   react-vendor → vendor           (sync import in source)
            //   routing-vendor → react-vendor   (sync import in source)
            //
            // Once routing-vendor is its own file, Rollup emits a
            // top-level `import { c as l } from "./react-vendor..."`
            // that evaluates before react-vendor's exports finish
            // binding on stricter module evaluators (Linux Chromium
            // pins older than ~M127 hits this). With everything in
            // one chunk, the binding is internal to a single file and
            // no top-level cross-chunk `import` is emitted.
            //
            // The downside is a single larger chunk, but react-router
            // and react-query already depend on react anyway, so the
            // net wire cost is roughly the same and we avoid the
            // module-eval TDZ crash on Linux.
            return 'react-vendor'
          }

          if (id.includes('@tauri-apps')) {
            return 'tauri-vendor'
          }

          if (id.includes('framer-motion')) {
            return 'motion-vendor'
          }

          if (id.includes('swiper')) {
            return 'swiper-vendor'
          }

          if (
            id.includes('@radix-ui') ||
            id.includes('lucide-react') ||
            id.includes('class-variance-authority') ||
            id.includes('clsx') ||
            id.includes('tailwind-merge')
          ) {
            return 'ui-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
})
