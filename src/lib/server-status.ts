/**
 * Server region catalogue for the header's server-status pill
 * and the `ServersPage` route.
 *
 * The launcher used to probe each region's player count against
 * the api's `GET /v1/playercount` endpoint. That probe has been
 * retired — the region list itself stays so NA / APAC can be
 * slotted in without changing the page implementation.
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
  {
    id: 'na',
    // North America (Chicago). Server hostname is a placeholder
    // — the real `na.zemu.uk:1115` host doesn't resolve yet, so
    // the launcher shows it as offline and the page renders the
    // row without a working capacity fill. Swap this when the
    // backend's DNS is live.
    label: 'North America',
    gameServer: 'na.zemu.uk:1115',
  },
  {
    id: 'apac',
    // Asia-Pacific (Singapore). Same placeholder story as NA —
    // hostname is reserved but not serving yet.
    label: 'Asia-Pacific',
    gameServer: 'apac.zemu.uk:1115',
  },
]