import { useEffect, useRef, useState } from 'react'

import { LoginPage } from '@/pages/login'
import { HomePage } from '@/pages/home'
import { AccessKeyProvisioner } from '@/components/new-launcher/access-key-provisioner'
import { MainLayout } from '@/components/main-layout'
import type { SidebarType } from '@/components/main-layout'
import { TitleBar } from '@/components/title-bar'
import { SiteNoticeBar } from '@/components/site-notice-bar'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'
import { EventPage } from '@/pages/event'
import { PlayPage } from '@/pages/play'
import { StreamsPage } from '@/pages/streams'
import { LeaderboardPage } from '@/pages/leaderboard'
import { PlayerPage } from '@/pages/player'
import { ClanPage } from '@/pages/clan'
import { ClanManagePage } from '@/pages/clan-manage'
import { ClansPage } from '@/pages/clans'
import { ServersPage } from '@/pages/servers'
import { GeneralPage } from '@/pages/settings'
import { AdvancedPage } from '@/pages/advanced'
import { AccountPage } from '@/pages/account'
import { AuthProvider, useAuthContext } from '@/contexts/auth-context'
import { useHash } from '@/hooks/use-hash'
import { UpdateProvider } from '@/contexts/update-context'
import { GameStateProvider } from '@/contexts/game-state-context'
import { Toaster } from '@/components/ui/sonner'
import { useFriendsIncomingToast } from '@/hooks/use-friends-incoming-toast'
import { useFriendsPresence } from '@/hooks/use-friends-presence'
import { useFriendsRealtimeSync } from '@/hooks/use-friends'
import { useAvatarSync } from '@/hooks/use-avatar-sync'
import { usePresenceHeartbeat } from '@/hooks/use-presence-heartbeat'
import { useEnrollHardware } from '@/hooks/use-enroll-hardware'
const INTENDED_HASH_KEY = 'zemu-launcher.intended-hash'

function parseRoute(hash: string | null): { page: string; params?: Record<string, string> } {
  // UI REWORK: the launcher lands on the (currently blank) home canvas
  // while the new main page is being built — with the sidebar
  // commented out there is no nav to reach `#/home` otherwise.
  // Revert to `{ page: 'play' }` to restore the old landing page.
  if (!hash || hash === '/') return { page: 'home' }

  const newsMatch = hash.match(/^\/news\/(.+)$/)
  if (newsMatch) return { page: 'news-slug', params: { slug: newsMatch[1] } }

  // Event detail — `/event/<id>`. Events have no slug column, so the
  // route carries the primary key (see `pages/event.tsx`).
  const eventMatch = hash.match(/^\/event\/([^/]+)$/)
  if (eventMatch) return { page: 'event', params: { id: eventMatch[1] } }

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

  if (hash === '/home') return { page: 'home' }
  if (hash === '/news') return { page: 'news' }
  if (hash === '/clans') return { page: 'clans' }
  if (hash === '/servers') return { page: 'servers' }
  if (hash === '/play') return { page: 'play' }
  if (hash === '/streams') return { page: 'streams' }
  if (hash === '/leaderboard') return { page: 'leaderboard' }
  if (hash === '/settings') return { page: 'settings' }
  if (hash === '/settings/advanced') return { page: 'advanced' }
  if (hash === '/account') return { page: 'account' }

  return { page: 'home' }
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
          <AccessKeyProvisioner />
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

  useEffect(() => {
    document.documentElement.classList.add('main-window')

    return () => {
      document.documentElement.classList.remove('main-window')
    }
  }, [])

  const prevPageRef = useRef(route.page)
  const isSettingsPage = route.page === 'settings' || route.page === 'advanced'
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
      next === 'settings' || next === 'advanced'
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

  if (status === 'loading') {
    return null
  }

  if (status !== 'authed' || !token) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg bg-background text-foreground border border-muted">
        <TitleBar />
        <SiteNoticeBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <LoginPage />
        </main>
      </div>
    )
  }

  // The install flow lives in the launcher footer (see
  // `C:\ZEmu\plan.md`), so no route owns the full screen anymore.

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg text-foreground border border-muted">
        <MainLayout
          // Launcher background: one image for every authed route. It
          // used to be play-page-only (`kotk_bg.webp`), which is gone.
          backgroundSrc="/background/app-bg.png"
          routeKey={hash ?? ''}
          sidebarType={sidebarType}
          // The Play / patch / install column is a home-page surface.
          showFooter={route.page === 'home'}
        >
        {route.page === 'news' && <NewsPage />}
        {route.page === 'news-slug' && route.params && <NewsSlugPage slug={route.params.slug} />}
        {route.page === 'event' && route.params && <EventPage id={route.params.id} />}
        {route.page === 'play' && <PlayPage />}
        {route.page === 'streams' && <StreamsPage />}
        {route.page === 'leaderboard' && <LeaderboardPage />}
        {route.page === 'player' && route.params && <PlayerPage displayName={route.params.displayName} />}
        {route.page === 'clan' && route.params && <ClanPage slug={route.params.slug} />}
        {route.page === 'clan-manage' && route.params && <ClanManagePage slug={route.params.slug} />}
        {route.page === 'clans' && <ClansPage />}
        {route.page === 'servers' && <ServersPage />}
        {route.page === 'settings' && <GeneralPage />}
        {route.page === 'advanced' && <AdvancedPage />}
        {route.page === 'account' && <AccountPage />}
        {route.page === 'home' && <HomePage />}
      </MainLayout>
    </div>
  )
}
