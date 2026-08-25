import { useEffect } from 'react'

import { LoginPage } from '@/pages/login'
import { HomePage } from '@/pages/home'
import { MainLayout } from '@/components/main-layout'
import { BootstrapPage } from '@/pages/bootstrap'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'
import { PlayPage } from '@/pages/play'
import { useAuthContext } from '@/contexts/auth-context'
import { useHash } from '@/hooks/use-hash'

const INTENDED_HASH_KEY = 'zemu-launcher.intended-hash'

function parseRoute(hash: string | null): { page: string; params?: Record<string, string> } {
  if (!hash || hash === '/') return { page: 'home' }

  const newsMatch = hash.match(/^\/news\/(.+)$/)
  if (newsMatch) return { page: 'news-slug', params: { slug: newsMatch[1] } }

  if (hash === '/news') return { page: 'news' }
  if (hash === '/play') return { page: 'play' }

  return { page: 'home' }
}

/**
 * Top-level app shell.
 *
 * Two windows in `src-tauri/tauri.conf.json` load the same React
 * bundle from `index.html`, distinguished only by the URL hash:
 *
 *   - `#/bootstrap` → Tauri's bootstrap / updater window (a small,
 *                     always-on-top 460×430 transparent window).
 *                     Rendered by `<BootstrapPage />`, which runs
 *                     the @tauri-apps/plugin-updater `check()` +
 *                     `downloadAndInstall()` flow and then invokes
 *                     the `launcher_finish_bootstrap` Rust command
 *                     to close this window and open the main one.
 *
 *   - `#/` or anything else → the main 1280×800 launcher window.
 *                     Renders the auth flow (login → home) based on
 *                     the `useAuth()` status.
 *
 * The split exists because the bootstrap window needs to stay
 * visible during a long-running update download — separating it
 * from the (much larger) main window keeps the UX clean.
 *
 * Route gating for the main window:
 *   - `#/` is the landing — renders LoginPage when signed out,
 *     HomePage when signed in.
 *   - Any other hash (`#/games/king-of-the-kill`, …) is a "deep
 *     route" that requires auth. If the user lands on one while
 *     signed out, we stash the intended hash in sessionStorage and
 *     bounce them to `#/`. After a successful sign-in we read the
 *     stash back and navigate there.
 */
export default function App() {
  const hash = useHash()

  // Bootstrap window — Tauri injects `index.html#/bootstrap` here.
  if (hash === '/bootstrap') {
    return <BootstrapPage />
  }

  return <AuthedApp />
}

function AuthedApp() {
  const { status, token } = useAuthContext()
  const hash = useHash()
  const route = parseRoute(hash)
  const isDeepRoute = hash !== null && hash !== '/' && route.page === 'home'

  // Bounce a signed-out user from a deep route back to the landing.
  // The hash state itself is read-only inside React; we mutate the
  // browser URL directly and let the `hashchange` event pick it up.
  useEffect(() => {
    if (status !== 'auth' && status !== 'loading') return
    if (!isDeepRoute) return
    sessionStorage.setItem(INTENDED_HASH_KEY, hash)
    // Defer to the next tick so the surrounding render isn't torn
    // down by a hash mutation it triggered itself. The effect will
    // re-run with the new (non-deep) hash, see `isDeepRoute` is
    // false, and bail out.
    queueMicrotask(() => {
      if (window.location.hash !== '#/') {
        window.location.hash = '#/'
      }
    })
    // We only depend on the inputs that should trigger this — once
    // we've redirected, the hash will change and the effect will
    // bail out via the `isDeepRoute` guard.
  }, [status, hash, isDeepRoute])

  // After a successful sign-in, send the user to the route they were
  // trying to reach before we bounced them. Cleared on consumption
  // so a sign-out cycle doesn't try to navigate to a stale path.
  useEffect(() => {
    if (status !== 'authed') return
    const intended = sessionStorage.getItem(INTENDED_HASH_KEY)
    if (!intended || intended === '/') {
      sessionStorage.removeItem(INTENDED_HASH_KEY)
      return
    }
    if (window.location.hash !== `#${intended}`) {
      window.location.hash = `#${intended}`
    }
    sessionStorage.removeItem(INTENDED_HASH_KEY)
  }, [status])

  if (status === 'loading') {
    return null
  }

  if (status !== 'authed' || !token) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg bg-background text-foreground border border-muted">
        <LoginPage />
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg bg-background text-foreground border border-muted">
      <MainLayout backgroundSrc={route.page === 'play' ? '/background/kotk_bg.jpg' : undefined} routeKey={hash}>
        {route.page === 'news' && <NewsPage />}
        {route.page === 'news-slug' && route.params && <NewsSlugPage slug={route.params.slug} />}
        {route.page === 'play' && <PlayPage />}
        {route.page === 'home' && <HomePage />}
      </MainLayout>
    </div>
  )
}