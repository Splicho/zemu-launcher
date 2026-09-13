import { useEffect, useRef, useState } from 'react'

import { LoginPage } from '@/pages/login'
import { HomePage } from '@/pages/home'
import { MainLayout } from '@/components/main-layout'
import type { SidebarType } from '@/components/main-layout'
import { TitleBar } from '@/components/title-bar'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'
import { PlayPage } from '@/pages/play'
import { GeneralPage } from '@/pages/settings'
import { AppearancePage } from '@/pages/appearance'
import { AccountPage } from '@/pages/account'
import { AuthProvider, useAuthContext } from '@/contexts/auth-context'
import { useHash } from '@/hooks/use-hash'
import { UpdateProvider } from '@/contexts/update-context'
import { GameStateProvider } from '@/contexts/game-state-context'
import { Toaster } from '@/components/ui/sonner'
import { useDownloadSpeedToast } from '@/hooks/use-download-speed-toast'
import { LAUNCHER_CONFIG } from '@/config/launcher'

const INTENDED_HASH_KEY = 'zemu-launcher.intended-hash'

function parseRoute(hash: string | null): { page: string; params?: Record<string, string> } {
  if (!hash || hash === '/') return { page: 'home' }

  const newsMatch = hash.match(/^\/news\/(.+)$/)
  if (newsMatch) return { page: 'news-slug', params: { slug: newsMatch[1] } }

  if (hash === '/news') return { page: 'news' }
  if (hash === '/play') return { page: 'play' }
  if (hash === '/settings') return { page: 'settings' }
  if (hash === '/settings/appearance') return { page: 'appearance' }
  if (hash === '/account') return { page: 'account' }

  return { page: 'home' }
}

function DownloadSpeedToast() {
  useDownloadSpeedToast()
  return null
}

export default function MainApp() {
  return (
    <AuthProvider>
      <UpdateProvider>
        <GameStateProvider>
          <AuthedApp />
          <DownloadSpeedToast />
          <Toaster />
        </GameStateProvider>
      </UpdateProvider>
    </AuthProvider>
  )
}

/**
 * All pages are now rendered inside `GameStateProvider`. The license
 * gate has been removed as part of the auth key rework — the game can
 * be launched once an auth key is saved locally, with no server
 * validation required.
 */

function AuthedApp() {
  const { status, token } = useAuthContext()
  const hash = useHash()
  const route = parseRoute(hash)
  const isDeepRoute = hash !== null && hash !== '/' && route.page === 'home'

  useEffect(() => {
    document.documentElement.classList.add('main-window')

    return () => {
      document.documentElement.classList.remove('main-window')
    }
  }, [])

  const prevPageRef = useRef(route.page)
  const isSettingsPage = route.page === 'settings' || route.page === 'appearance'
  const isAccountPage = route.page === 'account'
  const [sidebarType, setSidebarType] = useState<SidebarType>(
    isSettingsPage ? 'settings' : isAccountPage ? 'account' : 'app',
  )

  useEffect(() => {
    const next = route.page
    const prev = prevPageRef.current
    if (next === prev) return
    prevPageRef.current = next
    const nextType: SidebarType =
      next === 'settings' || next === 'appearance'
        ? 'settings'
        : next === 'account'
          ? 'account'
          : 'app'
    setSidebarType(nextType)
  }, [route.page])

  // Set the update URL in the backend on startup
  useEffect(() => {
    if (window.launcherAPI) {
      void window.launcherAPI.setRuntimeUpdateUrl(LAUNCHER_CONFIG.updateBaseUrl)
    }
  }, [])

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
  }, [status, hash, isDeepRoute])

  // After a successful sign-in, send the user to the route they were
  // trying to reach before we bounced them.
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
        <TitleBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <LoginPage />
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg bg-background text-foreground border border-muted">
        <MainLayout
          backgroundSrc={route.page === 'play' ? '/background/kotk_bg.webp' : undefined}
          routeKey={hash ?? ''}
          sidebarType={sidebarType}
        >
        {route.page === 'news' && <NewsPage />}
        {route.page === 'news-slug' && route.params && <NewsSlugPage slug={route.params.slug} />}
        {route.page === 'play' && <PlayPage />}
        {route.page === 'settings' && <GeneralPage />}
        {route.page === 'appearance' && <AppearancePage />}
        {route.page === 'account' && <AccountPage />}
        {route.page === 'home' && <HomePage />}
      </MainLayout>
    </div>
  )
}
