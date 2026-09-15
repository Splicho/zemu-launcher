/**
 * Friends-panel sub-components.
 *
 * Splitting the panel keeps each file focused on a single concern:
 *
 * - `friend-actions.tsx`   – one button component per relationship
 *                            (Remove / AcceptDecline / Cancel /
 *                            Add) plus a `<FriendActionBar />`
 *                            dispatcher.
 * - `player-result-row.tsx`– the avatar + display name row, with the
 *                            status dot colour map.
 * - `people-section.tsx`   – a labelled section that maps a list of
 *                            friends to <PlayerResultRow>.
 *
 * The main `friends-panel.tsx` continues to own data fetching,
 * routing between the list / add pages, and the search input.
 */

export {
  AddFriendAction,
  AcceptDeclineActions,
  CancelRequestAction,
  FriendActionBar,
  RemoveFriendAction,
} from '@/components/friends/friend-actions'
export type { FriendAction } from '@/components/friends/friend-actions'

export { PlayerResultRow, STATUS_DOT_CLASS } from '@/components/friends/player-result-row'

export { PeopleSection } from '@/components/friends/people-section'

export { SearchResultSkeleton } from '@/components/friends/search-result-skeleton'

export { AvatarStack } from '@/components/friends/avatar-stack'
export { FriendRequestsRow } from '@/components/friends/friend-requests-row'
export { FriendRequestToast } from '@/components/friends/friend-request-toast'
