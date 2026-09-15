import { useEffect, useRef, useState } from 'react'

import { LoginPage } from '@/pages/login'
import { HomePage } from '@/pages/home'
import { MainLayout } from '@/components/main-layout'
import type { SidebarType } from '@/components/main-layout'
import { TitleBar } from '@/components/title-bar'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'
import { OnboardingPage } from '@/pages/onboarding'
import { PlayPage } from '@/pages/play'
import { GeneralPage } from '@/pages/settings'
import { AppearancePage } from '@/pages/appearance'
import { AccountPage } from '@/pages/account'
import { AuthProvider, useAuthContext } from '@/contexts/auth-context'
import { useHash } from '@/hooks/use-hash'
import { useOnboardingGate } from '@/hooks/use-onboarding-gate'
import { UpdateProvider } from '@/contexts/update-context'
import { GameStateProvider } from '@/contexts/game-state-context'
import { Toaster } from '@/components/ui/sonner'
import { useDownloadSpeedToast } from '@/hooks/use-download-speed-toast'
import { useFriendsIncomingToast } from '@/hooks/use-friends-incoming-toast'
import { useFriendsRealtimeSync } from '@/hooks/use-friends'
import { LAUNCHER_CONFIG } from '@/config/launcher'

const INTENDED_HASH_KEY = 'zemu-launcher.intended-hash'

function parseRoute(hash: string | null): { page: string; params?: Record<string, string> } {
  if (!hash || hash === '/') return { page: 'home' }

  const newsMatch = hash.match(/^\/news\/(.+)$/)
  if (newsMatch) return { page: 'news-slug', params: { slug: newsMatch[1] } }

  if (hash === '/news') return { page: 'news' }
  if (hash === '/onboarding') return { page: 'onboarding' }
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

/** Mounted at the top level so friend-request toasts fire even when the Friends panel is closed. */
function FriendsIncomingToastHost() {
  const { status } = useAuthContext()
  useFriendsIncomingToast(status === 'authed')
  return null
}

/**
 * Mounted at the top level so the sidebar's `incomingRequestsCount`
 * badge (and any other component that reads the friends graph) is
 * invalidated whenever the realtime layer says anything changed —
 * regardless of whether the Friends panel is open. The panel used
 * to subscribe itself but that left the badge stale when the panel
 * was closed.
 */
function FriendsRealtimeSyncHost() {
  const { status } = useAuthContext()
  useFriendsRealtimeSync(status === 'authed')
  return null
}

export default function MainApp() {
  return (
    <AuthProvider>
      <UpdateProvider>
        <GameStateProvider>
          <AuthedApp />
          <DownloadSpeedToast />
          <FriendsIncomingToastHost />
          <FriendsRealtimeSyncHost />
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
  const onboardingGate = useOnboardingGate()
  const { state: gateState, refresh: refreshGate } = onboardingGate

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

  // First-run wizard redirect.
  //
  // For an authed user whose on-disk setup is incomplete, push them
  // into the wizard at `#/onboarding`. We deliberately run *after*
  // the intended-hash restore effect above so a deep-link sign-in
  // (e.g. OAuth callback returning to `/play`) lands on its real
  // destination first; only the landing page (`/` or empty hash)
  // gets pushed into the wizard.
  //
  // Returning users whose localStorage was wiped but who still have
  // a valid install on disk are caught by the gate and skip straight
  // to `/` (handled inside `useOnboardingGate`).
  useEffect(() => {
    if (status !== 'authed') return
    if (route.page === 'onboarding') return
    if (gateState.kind === 'loading') return
    if (gateState.kind === 'complete') return

    // Don't override an in-flight deep-link sign-in.
    const intended = sessionStorage.getItem(INTENDED_HASH_KEY)
    if (intended && intended !== '/') return

    queueMicrotask(() => {
      if (window.location.hash !== '#/onboarding') {
        window.location.hash = '#/onboarding'
      }
    })
  }, [status, route.page, gateState.kind])

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

  // The wizard owns the full screen — no title bar chrome, no main
  // layout, no sidebar. Renders inside the same rounded-window shell
  // for visual consistency with the rest of the app.
  if (route.page === 'onboarding') {
    const initialChecks =
      gateState.kind === 'incomplete'
        ? gateState.inputs
        : {
            hasKey: false,
            hasFolder: false,
            hasBaseGame: false,
            hasMarker: false,
            folderPath: null,
          }
    return (
      <OnboardingPage
        initialChecks={initialChecks}
        onRefreshGate={refreshGate}
      />
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
