import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heart, LogOut, MoreHorizontal, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { useHashRouter } from '@/hooks/use-hash'
import { useAuthContext } from '@/contexts/auth-context'
import {
  useFollowClan,
  useLeaveClan,
  useUnfollowClan,
} from '@/hooks/use-clan'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import { RequestJoinClanDialog } from '@/components/clan/request-join-clan-dialog'
import type { ClanProfile } from '@/lib/clan'

/**
 * Follow / Request to join / Manage / Leave overflow — the rightmost
 * group of buttons inside the clan identity row.
 *
 * Affordances are gated on `isAuthenticated` + the caller's
 * relationship to the clan:
 *
 *   1. **Request to join** — only for signed-in non-members of a
 *      *public* clan. Private clans hide the button entirely.
 *   2. **Follow / Following** — always visible to signed-in users
 *      (including members and leaders).
 *   3. **Manage clan** — leader- or officer-only, links to the
 *      manage page.
 *   4. **Overflow menu** — visible to every member. Today the only
 *      item is "Leave clan". The leave action surfaces the "last
 *      leader" rule as a toast.
 *
 * Why local follow state?
 *   The tooltip endpoint doesn't return a per-caller `isFollowing`
 *   bit yet, so the button flips optimistically and rolls back on
 *   error. The follow hooks refresh the underlying clan profile on
 *   success, which will eventually replace the optimistic state.
 *
 * Owns both `joinOpen` and `leaveOpen` so the request-join dialog and
 * the leave confirmation are colocated with their triggers — same
 * shape as the website's `apps/web/app/clans/[slug]/components/
 * clan-header.tsx`.
 */
export function ClanActions({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const { token } = useAuthContext()
  const { navigate } = useHashRouter()
  const isAuthed = token !== null

  const [joinOpen, setJoinOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const follow = useFollowClan(clan.slug)
  const unfollow = useUnfollowClan(clan.slug)
  const leave = useLeaveClan(clan.slug)
  const [isFollowingLocal, setIsFollowingLocal] = useState(false)

  // `ClanProfile.callerRole` is populated by the tooltip endpoint
  // when the request is authenticated — `fetchClanBySlug` forwards
  // the launcher's bearer so the api's `OptionalAuthGuard` resolves
  // the caller's membership and the role comes back on the same
  // response. `null` for signed-out visitors and non-members.
  const callerRole = clan.callerRole ?? null
  const isMember = callerRole !== null
  const isLeader = callerRole === 'leader'

  const toggleFollow = async () => {
    const wasFollowing = isFollowingLocal
    setIsFollowingLocal(!wasFollowing)
    try {
      if (wasFollowing) {
        await unfollow.mutateAsync()
      } else {
        await follow.mutateAsync()
      }
    } catch (err) {
      setIsFollowingLocal(wasFollowing)
      toast.error(t('clan.followError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await leave.mutateAsync()
      toast.success(t('clan.leftClan', { clantag: clan.clantag }))
      setLeaveOpen(false)
    } catch (err) {
      toast.error(t('clan.leaveError'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLeaving(false)
    }
  }

  const followMutating = follow.isPending || unfollow.isPending

  // Unauthenticated visitors don't see any CTA — there's no way to
  // follow without a session, and the "Join" CTA would just bounce
  // to a sign-in prompt that's clearer surfaced from the settings
  // page itself.
  if (!isAuthed) return null

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 pb-3 sm:pb-4">
        {!isMember && clan.isPrivate === false ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setJoinOpen(true)}
          >
            <UserPlus className="size-4" />
            {t('clan.requestToJoin')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={isFollowingLocal ? 'secondary' : 'default'}
          size="sm"
          onClick={toggleFollow}
          disabled={followMutating}
          className="gap-2"
          aria-pressed={isFollowingLocal}
        >
          {followMutating ? (
            <Spinner className="size-4" />
          ) : (
            <Heart
              className="size-4"
              fill={isFollowingLocal ? 'currentColor' : 'none'}
              aria-hidden
            />
          )}
          {followMutating
            ? isFollowingLocal
              ? t('clan.unfollowing')
              : t('clan.following')
            : isFollowingLocal
              ? t('clan.following')
              : t('clan.follow')}
        </Button>
        {isLeader || callerRole === 'officer' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() =>
              navigate(`/clan/${encodeURIComponent(clan.slug)}/manage`)
            }
          >
            {t('clan.manageClan')}
          </Button>
        ) : null}
        {isMember ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('clan.moreActions')}
                className="size-9"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  // Keep the dropdown open while the
                  // AlertDialog owns focus — Radix would
                  // close the menu before the dialog could
                  // grab Escape / click-outside handling.
                  event.preventDefault()
                  setLeaveOpen(true)
                }}
              >
                <LogOut className="size-4" />
                {t('clan.leaveClan')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/*
        Leave-clan confirmation. Lives outside the dropdown so the
        AlertDialog owns focus + Escape regardless of the dropdown's
        open state.
      */}
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('clan.leaveTitle', { clanName: clan.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('clan.leaveDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} disabled={leaving}>
              {leaving ? <Spinner className="size-4" /> : null}
              {leaving ? t('clan.leaving') : t('clan.leaveClan')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RequestJoinClanDialog
        slug={clan.slug}
        clanName={clan.name}
        clan={clan}
        open={joinOpen}
        onOpenChange={setJoinOpen}
      />
    </>
  )
}
