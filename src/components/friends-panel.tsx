import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { FriendsActionResult } from '@/lib/friends'
import { normalizeFriendRelationship } from '@/lib/friends'
import {
  useFriendsAccept,
  useFriendsCancel,
  useFriendsDecline,
  useFriendsGraph,
  useFriendsRemove,
  useFriendsRequest,
  useFriendsSearch,
} from '@/hooks/use-friends'
import {
  PeopleSection,
  FriendActionBar,
  SearchResultSkeleton,
  FriendRequestsRow,
  AcceptDeclineActions,
} from '@/components/friends'

interface FriendsPanelProps {
  /**
   * Whether the panel is currently visible. We use this to gate the
   * initial graph fetch — no point hitting the backend while the
   * Sheet is closed.
   */
  active: boolean
}

/**
 * Resolves the user-facing message for an action failure. The IPC
 * stub returns `reason: "not_implemented"` and we surface that as a
 * dedicated translation key so the user sees a clear "this isn't
 * wired up yet" message rather than a scary error.
 */
function resolveReason(
  reason: string | null | undefined,
  t: (key: string) => string,
): string | null {
  if (!reason) return null
  const key = `friends.errors.${reason}`
  const lookup = t(key)
  // `t` returns the key itself on miss, so probe explicitly so unknown
  // reasons fall through to the generic "unknown" copy.
  if (lookup === key) return t('friends.errors.unknown')
  return lookup
}

/** Stable list of placeholder rows shown while search results stream in. */
const SKELETON_RESULTS = Array.from({ length: 4 }, (_, i) => ({
  id: `skeleton-${i}`,
  displayName: '',
  avatarUrl: null,
  status: 'offline',
}))

/**
 * Renders the body of the Friends Sheet. The Sheet itself is just a
 * portal/overlay wrapper; this component owns the data fetching,
 * search form, and the per-row action buttons.
 */
export function FriendsPanel({ active }: FriendsPanelProps) {
  const graphQuery = useFriendsGraph({ enabled: active })
  const requestMutation = useFriendsRequest()
  const acceptMutation = useFriendsAccept()
  const declineMutation = useFriendsDecline()
  const cancelMutation = useFriendsCancel()
  const removeMutation = useFriendsRemove()

  const result: FriendsActionResult = graphQuery.data ?? {
    ok: true,
    reason: null,
    self: null,
    friends: [],
    incoming: [],
    outgoing: [],
    results: [],
  }

  const isBusy =
    graphQuery.isFetching ||
    requestMutation.isPending ||
    acceptMutation.isPending ||
    declineMutation.isPending ||
    cancelMutation.isPending ||
    removeMutation.isPending

  // The panel is split into two "pages":
  //   - 'list': the default friends list with the prominent
  //             "+ Add a friend" button.
  //   - 'add':  a dedicated Add Friends page with its own heading
  //             and search input. Clicking back returns to 'list'.
  // We keep the active search query in state so switching back and
  // forth doesn't lose what the user typed.
  const [page, setPage] = React.useState<'list' | 'add' | 'requests'>('list')

  // Reset to the list page whenever the panel becomes inactive so we
  // never land on the Add page with stale search state if the user
  // reopens the Sheet later.
  React.useEffect(() => {
    if (!active) setPage('list')
  }, [active])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {page === 'add' ? (
        <AddFriendsPage onBack={() => setPage('list')} />
      ) : page === 'requests' ? (
        <FriendRequestsPage
          result={result}
          isBusy={isBusy}
          onBack={() => setPage('list')}
          acceptMutation={acceptMutation}
          declineMutation={declineMutation}
        />
      ) : (
        <FriendsListPage
          result={result}
          isBusy={isBusy}
          onAddClick={() => setPage('add')}
          onRequestsClick={() => setPage('requests')}
          requestMutation={requestMutation}
          acceptMutation={acceptMutation}
          declineMutation={declineMutation}
          cancelMutation={cancelMutation}
          removeMutation={removeMutation}
        />
      )}
    </div>
  )
}

/** Mutations passed down to each row so FriendActionBar can call them directly. */
interface ActionMutations {
  requestMutation: ReturnType<typeof useFriendsRequest>
  acceptMutation: ReturnType<typeof useFriendsAccept>
  declineMutation: ReturnType<typeof useFriendsDecline>
  cancelMutation: ReturnType<typeof useFriendsCancel>
  removeMutation: ReturnType<typeof useFriendsRemove>
}

/**
 * Default page: shows the prominent "+ Add a friend" button at the top,
 * then the lists of incoming / outgoing / current friends below. Clicking
 * the button switches the panel to the Add Friends page.
 */
interface FriendsListPageProps extends ActionMutations {
  result: FriendsActionResult
  isBusy: boolean
  onAddClick: () => void
  onRequestsClick: () => void
}

function FriendsListPage({
  result,
  isBusy,
  onAddClick,
  onRequestsClick,
  requestMutation,
  acceptMutation,
  declineMutation,
  cancelMutation,
  removeMutation,
}: FriendsListPageProps) {
  const { t } = useTranslation()
  const errorMessage = resolveReason(result.reason, t)

  const renderRowActions = (
    person: (typeof result.friends)[number],
    relation: 'friend' | 'incoming' | 'outgoing' | 'none' | 'self',
  ) => (
    <FriendActionBar
      relation={relation}
      targetId={person.id}
      request={requestMutation}
      accept={acceptMutation}
      decline={declineMutation}
      cancel={cancelMutation}
      remove={removeMutation}
      disabled={isBusy}
    />
  )

  return (
    <>
      {/* Sticky header: "+ Add a friend" button. */}
      <div className="border-b bg-popover px-4 py-3">
        <Button
          variant="gradient"
          className="h-11 w-full gap-2 text-sm font-semibold"
          onClick={onAddClick}
        >
          <Plus className="!size-5" />
          {t('friends.addFriend')}
        </Button>
      </div>

      {/* Scrollable body: lists, empty states, error line. */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-6 px-4 py-4">
          {errorMessage ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </p>
          ) : null}

          {result.outgoing.length > 0 ? (
            <PeopleSection
              title={t('friends.sections.outgoing')}
              people={result.outgoing}
              emptyMessage={t('friends.empty')}
              renderActions={(person) =>
                renderRowActions(person, 'outgoing')
              }
            />
          ) : null}

          <PeopleSection
            title={t('friends.sections.friends')}
            people={result.friends}
            emptyMessage={t('friends.empty')}
            renderActions={(person) =>
              renderRowActions(person, 'friend')
            }
            headerAfter={
              <FriendRequestsRow
                people={result.incoming}
                count={result.incoming.length}
                onClick={onRequestsClick}
              />
            }
          />
        </div>
      </ScrollArea>

    </>
  )
}

/**
 * Add Friends page: dedicated view with a heading at the top and a
 * search input below. Submitting a query shows the matching people
 * underneath. Clicking the back button returns to the list page
 * without losing any data — the underlying graph query keeps running.
 */
interface AddFriendsPageProps {
  onBack: () => void
}

function AddFriendsPage({ onBack }: AddFriendsPageProps) {
  const { t } = useTranslation()
  const graphQuery = useFriendsGraph({ enabled: true })
  const requestMutation = useFriendsRequest()
  const acceptMutation = useFriendsAccept()
  const declineMutation = useFriendsDecline()
  const cancelMutation = useFriendsCancel()
  const removeMutation = useFriendsRemove()

  const [searchValue, setSearchValue] = React.useState('')
  const [activeQuery, setActiveQuery] = React.useState('')
  const [isDebouncing, setIsDebouncing] = React.useState(false)
  const searched = activeQuery.trim().length >= 2

  const searchQuery = useFriendsSearch(activeQuery, { enabled: searched })

  const isBusy =
    graphQuery.isFetching ||
    searchQuery.isFetching ||
    requestMutation.isPending ||
    acceptMutation.isPending ||
    declineMutation.isPending ||
    cancelMutation.isPending ||
    removeMutation.isPending

  // Debounce: fire the search 1.5 s after the user stops typing.
  React.useEffect(() => {
    const trimmed = searchValue.trim()
    if (trimmed.length < 2) {
      setIsDebouncing(false)
      return
    }
    setIsDebouncing(true)
    const timer = setTimeout(() => {
      setActiveQuery(trimmed)
      setIsDebouncing(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [searchValue])

  // Show the spinner while debouncing or fetching results.
  const showSpinner = isDebouncing || searchQuery.isFetching

  const result: FriendsActionResult = searched
    ? (searchQuery.data ?? {
        ok: true,
        reason: null,
        self: null,
        friends: [],
        incoming: [],
        outgoing: [],
        results: [],
      })
    : (graphQuery.data ?? {
        ok: true,
        reason: null,
        self: null,
        friends: [],
        incoming: [],
        outgoing: [],
        results: [],
      })

  const errorMessage = resolveReason(result.reason, t)

  const renderSearchRowActions = (person: (typeof result.results)[number]) => {
    const relation = normalizeFriendRelationship(person.relationship)
    return (
      <FriendActionBar
        relation={relation}
        targetId={person.id}
        request={requestMutation}
        accept={acceptMutation}
        decline={declineMutation}
        cancel={cancelMutation}
        remove={removeMutation}
        disabled={isBusy}
      />
    )
  }

  return (
    <>
      {/* Sticky header: back button + page heading + search input. */}
      <div className="sticky top-0 z-10 border-b bg-popover px-4 py-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={t('friends.actions.back')}
            className="shrink-0"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">{t('friends.actions.back')}</span>
          </Button>
          <h2 className="flex-1 text-base font-semibold">
            {t('friends.addFriendHeading')}
          </h2>
        </div>
        <div className="relative mt-3 flex-1">
          <Input
            value={searchValue}
            minLength={2}
            maxLength={64}
            required
            disabled={isBusy}
            placeholder={t('friends.searchPlaceholder')}
            aria-label={t('friends.searchPlaceholder')}
            className="h-10 pr-4"
            noFocusRing
            onChange={(event) => setSearchValue(event.target.value)}
          />
          {showSpinner ? (
            <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          ) : null}
        </div>
      </div>

      {/* Scrollable body: search results (or a hint when nothing searched yet). */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 px-4 py-4">
          {errorMessage ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </p>
          ) : null}

          {searched ? (
            searchQuery.isFetching && result.results.length === 0 ? (
              <PeopleSection
                title={t('friends.sections.resultsFound', { count: 0 })}
                people={SKELETON_RESULTS}
                emptyMessage={t('friends.empty')}
                renderActions={() => null}
                renderItem={() => <SearchResultSkeleton />}
              />
            ) : (
              <PeopleSection
                title={t('friends.sections.resultsFound', { count: result.results.length })}
                people={result.results}
                emptyMessage={t('friends.empty')}
                renderActions={renderSearchRowActions}
              />
            )
          ) : null}
        </div>
      </ScrollArea>
    </>
  )
}

/**
 * Friend requests page: shows all incoming requests with Accept/Decline
 * actions. Navigated to by clicking the "Friend requests" row above the
 * friends list.
 */
interface FriendRequestsPageProps {
  result: FriendsActionResult
  isBusy: boolean
  onBack: () => void
  acceptMutation: ReturnType<typeof useFriendsAccept>
  declineMutation: ReturnType<typeof useFriendsDecline>
}

function FriendRequestsPage({
  result,
  isBusy,
  onBack,
  acceptMutation,
  declineMutation,
}: FriendRequestsPageProps) {
  const { t } = useTranslation()
  return (
    <>
      {/* Sticky header: back button + page heading. */}
      <div className="sticky top-0 z-10 border-b bg-popover px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={t('friends.actions.back')}
            className="shrink-0"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">{t('friends.actions.back')}</span>
          </Button>
          <h2 className="flex-1 text-base font-semibold">
            {t('friends.friendRequestsHeading')}
          </h2>
        </div>
      </div>

      {/* Scrollable body: incoming request rows. */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 px-4 py-4">
          {result.incoming.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground/80">
              {t('friends.empty')}
            </p>
          ) : (
            <div className="flex flex-col">
              {result.incoming.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center gap-3 rounded-md px-2.5 py-2.5"
                >
                  <AvatarFallbackOrImage person={person} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">
                      {person.displayName}
                    </p>
                  </div>
                  <AcceptDeclineActions
                    targetId={person.id}
                    onAccept={(id) => acceptMutation.mutate({ targetId: id })}
                    onDecline={(id) => declineMutation.mutate({ targetId: id })}
                    disabled={isBusy}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

/** Minimal inline avatar for the requests page. */
function AvatarFallbackOrImage({ person }: { person: { displayName?: string | null; avatarUrl?: string | null } }) {
  return (
    <Avatar>
      {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
      <AvatarFallback>
        {(person.displayName ?? '?').slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
