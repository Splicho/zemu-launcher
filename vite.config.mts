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

          // Put React + ReactDOM + react-router + scheduler in the same
          // chunk so the runtime can resolve circular imports between
          // react-dom (consumer) and react (dependency) without hitting
          // a TDZ/undefined-reference error at module-eval time.
          if (
            id.includes(`${path.sep}react${path.sep}`) ||
            id.includes(`${path.sep}react-dom${path.sep}`) ||
            id.includes(`${path.sep}scheduler${path.sep}`)
          ) {
            return 'react-vendor'
          }

          if (id.includes('react-router') || id.includes('@tanstack/react-query')) {
            return 'routing-vendor'
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
