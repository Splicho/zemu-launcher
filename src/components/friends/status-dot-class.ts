import type { FriendStatus } from '@/lib/friends'

/**
 * Tailwind class fragment for each `FriendStatus`. Kept in its own
 * module (separate from `PlayerResultRow`) so the React Refresh
 * HMR boundary stays clean — exporting a constant alongside a
 * component trips `react-refresh/only-export-components`.
 *
 * The launcher narrowed `FriendStatus` to `online | in_game |
 * offline` per the LAUNCHER-API doc ("`away` / `busy` are never
 * sent"). The old `away` / `busy` entries stayed in a separate
 * legacy map so any in-flight realtime event still gets a non-fatal
 * colour if something legacy fires them.
 */
export const STATUS_DOT_CLASS: Record<FriendStatus, string> = {
  online: 'bg-emerald-500',
  in_game: 'bg-amber-500',
  offline: 'bg-zinc-500',
}

/** Same set as above, for legacy `away` / `busy` rows in the
 *  realtime patches. Greyed-out variants. */
export const LEGACY_STATUS_DOT_CLASS: Record<string, string> = {
  busy: 'bg-rose-500',
  away: 'bg-yellow-400',
}
