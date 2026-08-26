import '@/lib/tauri-bridge'

import { lazy, Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'

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

// Read the current Tauri window's label synchronously at module-load time.
// Both windows load the same React bundle from `index.html`, so we
// distinguish them by which Tauri window this webview is attached to:
//
//   - bootstrap window → render <BootstrapPage /> (updater UI)
//   - main window → render <MainApp />  (lazy-loaded launcher shell)
//
// `getCurrentWindow().label` returns synchronously — the `Window` object
// itself is a value type and `.label` is a sync getter, not an awaited
// property — so we can pick the route element inline without useState /
// useEffect. That also avoids the "Unused label" lint complaint and the
// flash-of-spinner that an effect-driven mount would cause.
function detectBootstrapWindow(): boolean {
  try {
    return getCurrentWindow().label === 'bootstrap'
  } catch {
    return false
  }
}

/**
 * Top-level router.
 *
 * Both Tauri windows load `index.html` (the same React bundle). They
 * are distinguished by their Tauri `label` — see `detectBootstrapWindow`
 * above. The previous design tried to use a per-window `url` like
 * `index.html#/bootstrap` in `tauri.conf.json`, but Tauri 2 silently
 * drops that static URL field and leaves the webview at `about:blank`
 * (see `bootstrap` setup probe in `lib.rs` — reported
 * `url=about:blank`). Detecting the window label at module load and
 * routing accordingly sidesteps the bug entirely.
 *
 * The bootstrap window still gets `index.html` (Tauri's default), and
 * the main window also gets `index.html` — they share the same bundle
 * and just render different routes.
 */
export default function App() {
  const isBootstrap = detectBootstrapWindow()

  if (isBootstrap) {
    return <BootstrapPage />
  }

  return (
    <HashRouter>
      <Suspense fallback={<AppLoader />}>
        <Routes>
          <Route path="*" element={<MainApp />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}