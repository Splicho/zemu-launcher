import '@/lib/tauri-bridge'

import { lazy, Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

import { BootstrapPage } from '@/pages/bootstrap'
import { Spinner } from '@/components/ui/spinner'

const MainApp = lazy(() =>
  import('@/main-app').then((module) => ({ default: module.default })),
)

function AppLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground dark">
      <Spinner className="h-8 w-8 text-primary" />
    </div>
  )
}

/**
 * Top-level router.
 *
 * Both Tauri windows load the same React bundle from `index.html`,
 * distinguished by the URL hash that's set per-window in
 * `src-tauri/tauri.conf.json`'s `app.windows[]`:
 *
 *   - `bootstrap` window: `url: "index.html#/bootstrap"` →
 *     this hash router renders `<BootstrapPage />`, which runs
 *     `@tauri-apps/plugin-updater` and invokes
 *     `launcher_finish_bootstrap` to swap in the main window.
 *
 *   - `main` window: `url` is unset, so Tauri opens at the bundled
 *     `index.html` (hash=`#/`) → catch-all `<MainApp />` renders.
 *
 * Hash-based routing keeps everything in a single React tree per
 * window and avoids the Tauri 2 pitfall where
 * `WebviewUrl::App("index.html#/bootstrap")` silently drops the
 * fragment and resolves the window to `about:blank`. The
 * `tauri.conf.json` `url` field, on the other hand, does preserve
 * the hash when the framework itself creates the window.
 */
export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<AppLoader />}>
        <Routes>
          <Route path="/bootstrap" element={<BootstrapPage />} />
          <Route path="*" element={<MainApp />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
