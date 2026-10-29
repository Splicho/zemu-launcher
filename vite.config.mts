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
    /**
     * The remaining `vendor` chunk is React + ReactDOM + the few packages that
     * cannot be split without reintroducing the cross-chunk cycle described
     * below (`vendor` must never import another chunk). It settles around
     * 530 KB minified / 173 KB gzipped, which is fine for a desktop app that
     * loads from disk — raise the advisory limit so a successful build doesn't
     * print a warning we've deliberately accepted.
     */
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        /**
         * Chunk plan.
         *
         * History: splitting npm packages arbitrarily broke the packaged build.
         * `vendor` imported `ui-vendor`, `ui-vendor` imported `react-vendor`,
         * and `react-vendor` imported `vendor` again — a cross-chunk cycle
         * whose top-level imports evaluate in the wrong order, leaving React
         * `undefined` at `createContext` time (blank window, no UI).
         *
         * So the rule here is: a package only gets its own chunk if it is a
         * *leaf* — it may import from `vendor`, but nothing inside `vendor`
         * imports it. That keeps every chunk edge one-directional
         * (`X → vendor`, never `vendor → X`), which makes cycles impossible.
         *
         * Chart libraries are deliberately *not* named here: they're only
         * reached through `React.lazy(() => import(...))`, so letting Rollup
         * place them gives them their own async chunk, loaded the first time a
         * player profile with matches is opened instead of at startup.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('@tauri-apps')) {
            return 'tauri-vendor'
          }

          // Lazy: only the player chart imports these, and only via a dynamic
          // import. Returning `undefined` lets Rollup emit an async chunk.
          if (
            id.includes('recharts') ||
            id.includes('victory-vendor') ||
            id.includes('d3-') ||
            id.includes('internmap') ||
            id.includes('decimal.js-light')
          ) {
            return undefined
          }

          // Leaf UI packages: animation, icons and the Radix primitives. They
          // import React from `vendor`; nothing in `vendor` imports them.
          if (id.includes('framer-motion')) {
            return 'motion-vendor'
          }

          if (id.includes('lucide-react')) {
            return 'icons-vendor'
          }

          if (id.includes('@radix-ui')) {
            return 'radix-vendor'
          }

          // More leaves: data/query layer, i18n runtime, the carousel and the
          // markdown stack used by news/clan bodies. Each imports React from
          // `vendor` and is imported by app code only.
          if (id.includes('@tanstack')) {
            return 'query-vendor'
          }

          if (id.includes('i18next')) {
            return 'i18n-vendor'
          }

          if (id.includes('swiper')) {
            return 'swiper-vendor'
          }

          if (
            id.includes('react-markdown') ||
            id.includes('remark-') ||
            id.includes('rehype-') ||
            id.includes('micromark') ||
            id.includes('mdast') ||
            id.includes('hast-util') ||
            id.includes('unist-util') ||
            id.includes('unified') ||
            id.includes('vfile') ||
            id.includes('property-information') ||
            id.includes('space-separated-tokens') ||
            id.includes('comma-separated-tokens') ||
            id.includes('character-entities') ||
            id.includes('decode-named-character-reference') ||
            id.includes('parse-entities') ||
            id.includes('style-to-object') ||
            id.includes('inline-style-parser') ||
            id.includes('html-url-attributes') ||
            id.includes('markdown-table') ||
            id.includes('longest-streak') ||
            id.includes('trim-lines') ||
            id.includes('devlop') ||
            id.includes('bail') ||
            id.includes('trough') ||
            id.includes('zwitch') ||
            id.includes('ccount') ||
            id.includes('is-plain-obj')
          ) {
            return 'markdown-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
})
