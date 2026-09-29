import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { CountryFlagThumb } from '@/components/leaderboard/country-flag-thumb'
import { SERVERS, type ServerRegion } from '@/lib/server-status'
import { usePlayerCount } from '@/hooks/use-playercount'
import { cn } from '@/lib/utils'

/**
 * Servers page — mounted at `#/servers`.
 *
 * Each region in the `SERVERS` catalogue renders a header (flag +
 * label + server count) and a stack of per-server rows. The
 * capacity bar lives inside the row — the api returns one total
 * per region today, so every row in a region shares the same fill,
 * matching how the launcher has historically drawn it.
 *
 * Player count is pulled live from `GET /v1/playercount` via
 * `usePlayerCount`, scoped per region so the probe is forward-
 * compatible with NA / APAC.
 */
export function ServersPage() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-8 pt-6 pb-4">
        <header>
          <h1 className="text-3xl tracking-tight">
            {t('nav.servers')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('servers.placeholderSubtitle')}
          </p>
        </header>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="space-y-4">
          {SERVERS.map((region) => (
            <RegionSection key={region.id} region={region} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * One region's worth of UI — header + server list. Owns the
 * `usePlayerCount` call so the probe is scoped per-region and the
 * row component stays a pure presentational element that receives
 * the live capacity through props.
 *
 * NA / APAC are placeholders today: their game-server hostnames
 * don't resolve yet, and the api exposes a single global
 * `/v1/playercount` (EU only). Calling the probe for those
 * regions would either return EU's count — misleading — or 404
 * later when per-region endpoints land. Pass `null` to the hook
 * to disable the probe cleanly; the row renders the em-dash state
 * instead of a fake bar.
 */
function RegionSection({ region }: { region: ServerRegion }) {
  const { t } = useTranslation()
  const probeRegion = isLiveRegion(region.id) ? region.id : null
  const { total, isPending, isError, disabled } = usePlayerCount(probeRegion)
  const servers = REGION_SERVERS[region.id] ?? []

  return (
    <section className="space-y-2">
      <RegionHeader region={region} serverCount={servers.length} />
      <ServerList
        servers={servers}
        total={total}
        isPending={isPending}
        isError={isError}
        disabled={disabled}
      />
      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('servers.placeholderBody')}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Region header — outlined badge carrying the country flag, the
 * region label and the number of servers in the region.
 *
 * Header is intentionally text-only: the capacity visualisation
 * lives on each row, where the layout already reserves a right-
 * aligned slot for it.
 */
function RegionHeader({
  region,
  serverCount,
}: {
  region: ServerRegion
  serverCount: number
}) {
  const { t } = useTranslation()
  return (
    <Badge
      variant="outline"
      className="h-7 gap-1.5 rounded-md bg-background/60 px-2.5 pr-px text-sm font-medium"
    >
      <CountryFlagThumb
        code={regionFlag(region.id)}
        size={16}
        className="rounded-[2px]"
      />
      <span>
        {t(`servers.regions.${regionIdToNamespace(region.id)}.label`)}
      </span>
      <Badge
        variant="secondary"
        className="ml-1 mr-0.5 h-5 rounded-md text-[11px]"
      >
        {serverCount}
      </Badge>
    </Badge>
  )
}

/**
 * Vertical stack of server rows inside a rounded container.
 *
 * The wrapper is the rounded rectangle; each row fills the full
 * width and inherits the rounded corners from the wrapper's
 * `overflow-hidden`. Odd-indexed rows get a tinted background so
 * the alternating rhythm reads at a glance.
 *
 * Passes the region's live capacity down to every row so the bar
 * renders inside the row stack (matches the launcher's historic
 * layout). All rows in a region share the same fill today — the
 * api returns one total, not per-server.
 */
function ServerList({
  servers,
  total,
  isPending,
  isError,
  disabled,
}: {
  servers: ReadonlyArray<Server>
  total: number | undefined
  isPending: boolean
  isError: boolean
  disabled: boolean
}) {
  if (servers.length === 0) return null
  return (
    <ul className="overflow-hidden rounded-md border border-border/40">
      {servers.map((server, idx) => (
        <li
          key={server.id}
          className={cn(
            'bg-card/40',
            // Even index → 1st, 3rd, ... → muted tint for contrast.
            idx % 2 === 1 && 'bg-muted/40',
          )}
        >
          <ServerRow
            server={server}
            total={total}
            isPending={isPending}
            isError={isError}
            disabled={disabled}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * One server line — pulsing status dot, location name, and the
 * capacity progress bar (max 2000, value not shown as a number).
 *
 * Bar states (in priority order):
 *   - `disabled` → muted "—" dash — region not yet wired up in the
 *                   api. Distinct from `isError` so a region that's
 *                   "coming soon" doesn't render the same as a
 *                   region that's offline.
 *   - `isError`  → "N/A" pill — api call failed.
 *   - `isPending` → animated skeleton slot (same width as the bar).
 *   - otherwise  → cyan→violet fill against `MAX_PLAYERS`.
 *
 * Width is locked at 8 rem across all states so the column doesn't
 * reflow as data lands.
 */
function ServerRow({
  server,
  total,
  isPending,
  isError,
  disabled,
}: {
  server: Server
  total: number | undefined
  isPending: boolean
  isError: boolean
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* Pulsing status dot. Green = healthy, red = degraded. */}
      <ServerStatusDot status={server.status} />

      {/* Location label — server-specific name (e.g. "Frankfurt"). */}
      <span className="min-w-0 truncate text-sm font-medium">
        {server.location}
      </span>

      {/* Right slot — capacity bar, skeleton, N/A pill or "—".
          Width is identical in all states so the column stays
          aligned across rows and regions. */}
      <div className="ml-auto flex w-32 items-center justify-end">
        {disabled ? (
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            —
          </span>
        ) : isError ? (
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            N/A
          </span>
        ) : isPending || total === undefined ? (
          <div
            aria-hidden
            className="h-1.5 w-32 animate-pulse rounded-full bg-muted-foreground/15"
          />
        ) : (
          <PlayerFillBar players={total} />
        )}
      </div>
    </div>
  )
}

/**
 * Player-fill bar — width-only, no numeric readout. Custom div
 * instead of <Progress/> so the gradient fill is fully owned by
 * this page and the shared component stays neutral.
 *
 * Clamped 0–100 so a typo'd API response can't blow up the bar.
 */
function PlayerFillBar({ players }: { players: number }) {
  const fillPct = Math.max(
    0,
    Math.min(100, (players / MAX_PLAYERS) * 100),
  )
  return (
    <div
      className="h-1.5 w-32 overflow-hidden rounded-full bg-muted-foreground/15"
      role="progressbar"
      aria-label="Player capacity"
      aria-valuenow={players}
      aria-valuemin={0}
      aria-valuemax={MAX_PLAYERS}
    >
      <span
        className="block h-full rounded-full transition-all"
        style={{
          width: `${fillPct}%`,
          // Cyan → violet — a cooler palette than green/red so it
          // reads as capacity rather than health.
          background:
            'linear-gradient(90deg, oklch(0.78 0.14 215), oklch(0.62 0.22 295))',
        }}
      />
    </div>
  )
}

/** Tiny pulsing circle — green when online, red when offline. */
function ServerStatusDot({ status }: { status: Server['status'] }) {
  const isOnline = status === 'online'
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      <span
        className={cn(
          'absolute inset-0 inline-flex animate-ping rounded-full opacity-60',
          isOnline ? 'bg-emerald-500' : 'bg-red-500',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'relative inline-flex size-2.5 rounded-full',
          isOnline ? 'bg-emerald-500' : 'bg-red-500',
        )}
        aria-label={isOnline ? 'Online' : 'Offline'}
      />
    </span>
  )
}

// ─── Static server catalogue ──────────────────────────────────────────────

interface Server {
  id: string
  location: string
  status: 'online' | 'offline'
}

/**
 * Per-region server inventory. Live player counts come from the
 * api (see `usePlayerCount`) and are plumbed into every row in
 * the region — this file only owns the static `location` +
 * `status` data.
 *
 * Today only Frankfurt (EU) is wired up. Chicago (NA) is declared
 * but offline, APAC is empty so the page renders the N/A body copy.
 * Adding NA / APAC later is a one-key entry per region.
 */
const REGION_SERVERS: Record<
  ServerRegion['id'],
  ReadonlyArray<Server>
> = {
  eu: [
    { id: 'eu-fra', location: 'Frankfurt', status: 'online' },
  ],
  na: [
    { id: 'na-chi', location: 'Chicago', status: 'offline' },
  ],
  apac: [
    { id: 'apac-sin', location: 'Singapore', status: 'offline' },
  ],
}

/** Player cap used to compute the progress-bar fill. Constant for now
 *  so the visual rhythm stays consistent across regions. */
const MAX_PLAYERS = 2000

/**
 * Whether a region has a working player-count probe. Today only EU
 * does — the api returns a single global total, not per-region
 * numbers, so NA / APAC would either display EU's count (wrong)
 * or 404 once per-region endpoints ship. Toggle a region on here
 * when its dedicated endpoint is wired up server-side.
 */
function isLiveRegion(id: ServerRegion['id']): boolean {
  return id === 'eu'
}

/** Region id → 2-letter ISO code for the header flag pill. */
function regionFlag(id: ServerRegion['id']): string {
  switch (id) {
    case 'eu':
      return 'eu'
    case 'na':
      return 'us'
    case 'apac':
      return 'sg'
  }
}

/** Region id → i18n namespace segment under `servers.regions`. */
function regionIdToNamespace(id: ServerRegion['id']): string {
  switch (id) {
    case 'eu':
      return 'europe'
    case 'na':
      return 'northAmerica'
    case 'apac':
      return 'asia'
  }
}