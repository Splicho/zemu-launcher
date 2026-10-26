/**
 * Server region catalogue for the header's server-status pill
 * and the `ServersPage` route.
 *
 * The catalogue itself is static; live player counts are fetched
 * separately, one probe per region, from the api's
 * `GET /v1/playercount?region=…` endpoint (see `usePlayerCount`).
 * Keeping the two apart means a region can be listed here before
 * the api has an upstream for it — the page just renders it
 * without a capacity bar.
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
    // North America (Chicago). Live headcount comes from the api's
    // `?region=na` probe, which owns the Chicago upstream — the
    // launcher never talks to the game server itself. `gameServer`
    // stays reserved for direct game connections.
    label: 'North America',
    gameServer: 'na.zemu.uk:1115',
  },
  {
    id: 'apac',
    // Asia-Pacific (Singapore). No upstream yet — the api doesn't
    // serve an APAC region, so the page leaves the probe off and
    // shows the em-dash state.
    label: 'Asia-Pacific',
    gameServer: 'apac.zemu.uk:1115',
  },
]