import type { FriendStatus } from '@/lib/friends'

/**
 * Tailwind class fragment for each `FriendStatus`. Kept in its own
 * module (separate from `PlayerResultRow`) so the React Refresh
 * HMR boundary stays clean — exporting a constant alongside a
 * component trips `react-refresh/only-export-components`.
 */
export const STATUS_DOT_CLASS: Record<FriendStatus, string> = {
  online: 'bg-emerald-500',
  in_game: 'bg-amber-500',
  busy: 'bg-rose-500',
  away: 'bg-yellow-400',
  offline: 'bg-zinc-500',
}
