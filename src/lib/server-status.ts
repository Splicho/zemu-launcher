/**
 * Server region catalogue for the header's server-status pill.
 *
 * The launcher used to probe each region's player count against
 * the api's `GET /v1/playercount` endpoint. That probe (and the
 * entire `InternalApiGuard`-gated plumbing it required) has been
 * retired — the header pill now surfaces a static region
 * label + status dot only.
 *
 * The region list itself stays so NA / APAC can be slotted in
 * without changing the dropdown implementation.
 */

export interface ServerRegion {
  /** Stable id used as the React key + the dropdown row key. */
  id: 'eu' | 'na' | 'apac'
  /** Display label rendered in the dropdown (e.g. "Europe"). */
  label: string
  /** Game-server host:port shown on the row (e.g. "eu.zemu.uk:1115"). */
  gameServer: string
}

export const SERVERS: readonly ServerRegion[] = [
  {
    id: 'eu',
    label: 'Europe',
    gameServer: 'eu.zemu.uk:1115',
  },
]
