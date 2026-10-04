import { useEffect, useRef, useState } from 'react'

import { LoginPage } from '@/pages/login'
import { HomePage } from '@/pages/home'
import { MainLayout } from '@/components/main-layout'
import type { SidebarType } from '@/components/main-layout'
import { TitleBar } from '@/components/title-bar'
import { SiteNoticeBar } from '@/components/site-notice-bar'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'
import { OnboardingPage } from '@/pages/onboarding'
import { InstallCheckPage } from '@/pages/install-check'
import { PlayPage } from '@/pages/play'
import { StreamsPage } from '@/pages/streams'
import { LeaderboardPage } from '@/pages/leaderboard'
import { PlayerPage } from '@/pages/player'
import { ClanPage } from '@/pages/clan'
import { ClanManagePage } from '@/pages/clan-manage'
import { ClansPage } from '@/pages/clans'
import { ServersPage } from '@/pages/servers'
import { GeneralPage } from '@/pages/settings'
import { AppearancePage } from '@/pages/appearance'
import { AdvancedPage } from '@/pages/advanced'
import { AccountPage } from '@/pages/account'
import { AuthProvider, useAuthContext } from '@/contexts/auth-context'
import { useHash } from '@/hooks/use-hash'
import { useOnboardingGate } from '@/hooks/use-onboarding-gate'
import { UpdateProvider } from '@/contexts/update-context'
import { GameStateProvider } from '@/contexts/game-state-context'
import { Toaster } from '@/components/ui/sonner'
import { useDownloadSpeedToast } from '@/hooks/use-download-speed-toast'
import { useFriendsIncomingToast } from '@/hooks/use-friends-incoming-toast'
import { useFriendsPresence } from '@/hooks/use-friends-presence'
import { useFriendsRealtimeSync } from '@/hooks/use-friends'
import { useAvatarSync } from '@/hooks/use-avatar-sync'
import { usePresenceHeartbeat } from '@/hooks/use-presence-heartbeat'
import { useEnrollHardware } from '@/hooks/use-enroll-hardware'
const INTENDED_HASH_KEY = 'zemu-launcher.intended-hash'

function parseRoute(hash: string | null): { page: string; params?: Record<string, string> } {
  if (!hash || hash === '/') return { page: 'home' }

  const newsMatch = hash.match(/^\/news\/(.+)$/)
  if (newsMatch) return { page: 'news-slug', params: { slug: newsMatch[1] } }

  // Player profile — `/player/<displayName>`. The display name can
  // contain spaces / punctuation, so we match the rest of the
  // hash as-is and decodeURIComponent on the way in (see
  // `pages/player.tsx`). Same approach as `news-slug` above.
  const playerMatch = hash.match(/^\/player\/(.+)$/)
  if (playerMatch) {
    return { page: 'player', params: { displayName: playerMatch[1] } }
  }

  // Clan profile — `/clan/<slug>`. Slugs are URL-safe already
  // (3-32 chars from the api service's slug rule), so we still
  // decode for display only.
  const clanMatch = hash.match(/^\/clan\/(.+)$/)
  if (clanMatch) {
    // Distinguish `/clan/<slug>` (public profile) from
    // `/clan/<slug>/manage` (manage page). The order matters —
    // match the longer path first.
    const manageMatch = hash.match(/^\/clan\/(.+)\/manage$/)
    if (manageMatch) {
      return { page: 'clan-manage', params: { slug: manageMatch[1] } }
    }
    return { page: 'clan', params: { slug: clanMatch[1] } }
  }

  if (hash === '/news') return { page: 'news' }
  if (hash === '/clans') return { page: 'clans' }
  if (hash === '/servers') return { page: 'servers' }
  if (hash === '/onboarding') return { page: 'onboarding' }
  if (hash === '/install-check') return { page: 'install-check' }
  if (hash === '/play') return { page: 'play' }
  if (hash === '/streams') return { page: 'streams' }
  if (hash === '/leaderboard') return { page: 'leaderboard' }
  if (hash === '/settings') return { page: 'settings' }
  if (hash === '/settings/appearance') return { page: 'appearance' }
  if (hash === '/settings/advanced') return { page: 'advanced' }
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

/**
 * Mounted at the top level so the avatar-badge dot and
 * "Currently playing" sub-line stay current even when the Friends
 * panel is closed. Patches the cached graph in place when a
 * `friends:presence-updated` Tauri event arrives, so the sidebar /
 * panel render the new status without a refetch.
 */
function FriendsPresenceHost() {
  const { status } = useAuthContext()
  useFriendsPresence(status === 'authed')
  return null
}

/**
 * Mounted at the top level so the user's own heartbeat keeps
 * flowing even when no friends-related UI is mounted. Drives
 * `POST /v1/presence/heartbeat` every 30s with a status derived
 * from `gameLaunchState.isRunning`.
 */
function PresenceHeartbeatHost() {
  const { status } = useAuthContext()
  usePresenceHeartbeat(status === 'authed')
  return null
}

/**
 * Mounted at the top level so the avatar (the user's 64x64 icon on
 * the game server) auto-syncs once the user is signed in AND has a
 * ZEmu auth key saved. Failures are swallowed; the user never
 * sees a "your avatar didn't upload" toast.
 *
 * One attempt per session per source URL. Re-linked providers
 * with a new picture reset the dedupe via `user.image` changing.
 */
function AvatarSyncHost() {
  const { status } = useAuthContext()
  useAvatarSync(status === 'authed')
  return null
}

/**
 * Mounted at the top level so the launcher's hardware-identity
 * enrollment fires once per `'authed'` resolution, regardless of
 * which page the user is on. The Rust side does the actual lift
 * (TPM ladder + OS-UUID fallback + API POST); the renderer just
 * enqueues the call on a short idle delay and silently swallows
 * failures. See `use-enroll-hardware.ts` for the full rationale.
 */
function EnrollHardwareHost() {
  const { status } = useAuthContext()
  useEnrollHardware(status)
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
          <FriendsPresenceHost />
          <PresenceHeartbeatHost />
          <AvatarSyncHost />
          <EnrollHardwareHost />
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
  const isSettingsPage = route.page === 'settings' || route.page === 'appearance' || route.page === 'advanced'
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
      next === 'settings' || next === 'appearance' || next === 'advanced'
        ? 'settings'
        : next === 'account'
          ? 'account'
          : 'app'
    setSidebarType(nextType)
  }, [route.page])

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
  // into the install-check pre-screen at `#/install-check`. That
  // screen asks "do you already have the Pre-Season 3 client?" —
  // clicking "Yes" commits the Rust-side
  // `LauncherConfig.onboarding_completed` flag and lands them on
  // `/` directly, while "No, I need to download" routes them into
  // the wizard at `#/onboarding`. This split avoids re-walking a
  // returning user whose disk has drifted out of sync with the gate
  // (e.g. the `.zemu-install-v1` marker is missing because they
  // copied an old PS3 folder by hand).
  //
  // We deliberately run *after* the intended-hash restore effect
  // above so a deep-link sign-in (e.g. OAuth callback returning to
  // `/play`) lands on its real destination first; only the landing
  // page (`/` or empty hash) gets pushed into the install-check.
  //
  // Returning users whose onboarding flag was reset but who still
  // have a valid install on disk are caught by the gate and skip
  // straight to `/` (handled inside `useOnboardingGate`).
  useEffect(() => {
    if (status !== 'authed') return
    if (route.page === 'onboarding' || route.page === 'install-check') return
    if (gateState.kind === 'loading') return
    if (gateState.kind === 'complete') return

    // Don't override an in-flight deep-link sign-in.
    const intended = sessionStorage.getItem(INTENDED_HASH_KEY)
    if (intended && intended !== '/') return

    queueMicrotask(() => {
      if (window.location.hash !== '#/install-check') {
        window.location.hash = '#/install-check'
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
        <SiteNoticeBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <LoginPage />
        </main>
      </div>
    )
  }

  // The install-check pre-screen and the onboarding wizard both
  // own the full screen — no `<MainLayout>`, no sidebar. They
  // render their own `<TitleBar />` inside the page for visual
  // consistency with the rest of the app. Both pages receive the
  // same `initialChecks` shape so they can hydrate from the same
  // gate evaluation.
  if (route.page === 'install-check' || route.page === 'onboarding') {
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

    if (route.page === 'install-check') {
      return (
        <InstallCheckPage
          initialChecks={initialChecks}
          onRefreshGate={refreshGate}
        />
      )
    }

    return (
      <OnboardingPage
        initialChecks={initialChecks}
        onRefreshGate={refreshGate}
        bearerToken={token?.token ?? null}
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
        {route.page === 'streams' && <StreamsPage />}
        {route.page === 'leaderboard' && <LeaderboardPage />}
        {route.page === 'player' && route.params && <PlayerPage displayName={route.params.displayName} />}
        {route.page === 'clan' && route.params && <ClanPage slug={route.params.slug} />}
        {route.page === 'clan-manage' && route.params && <ClanManagePage slug={route.params.slug} />}
        {route.page === 'clans' && <ClansPage />}
        {route.page === 'servers' && <ServersPage />}
        {route.page === 'settings' && <GeneralPage />}
        {route.page === 'appearance' && <AppearancePage />}
        {route.page === 'advanced' && <AdvancedPage />}
        {route.page === 'account' && <AccountPage />}
        {route.page === 'home' && <HomePage />}
      </MainLayout>
    </div>
  )
}
