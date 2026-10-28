import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { CountryFlagThumb } from '@/components/leaderboard/country-flag-thumb'
import { SERVERS, type ServerRegion } from '@/lib/server-status'
import { cn } from '@/lib/utils'

/**
 * Servers page — mounted at `#/servers`.
 *
 * Each region in the `SERVERS` catalogue renders a header (flag + label +
 * server count) and a stack of per-server rows. Rows are deliberately
 * text-only: status dot plus the location name.
 *
 * The per-region player-capacity bar was removed — it duplicated the
 * `NETWORK` stats on the home footer with a different unit (a wordless
 * progress bar), and the api only ever returns one total per region, so
 * every row in a region drew the same fill. `usePlayerCount` and the
 * `/v1/playercount` client stay in the codebase for the surfaces that
 * still want a live headcount.
 */
export function ServersPage() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-8 pt-6 pb-4">
        <header>
          <h1 className="text-3xl tracking-tight">{t('nav.servers')}</h1>
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

/** One region's worth of UI — header + server list. */
function RegionSection({ region }: { region: ServerRegion }) {
  const { t } = useTranslation()
  const servers = REGION_SERVERS[region.id] ?? []

  return (
    <section className="space-y-2">
      <RegionHeader region={region} serverCount={servers.length} />
      <ServerList servers={servers} />
      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('servers.placeholderBody')}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Region header — outlined badge carrying the country flag, the region
 * label and the number of servers in the region.
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
      <span>{t(`servers.regions.${regionIdToNamespace(region.id)}.label`)}</span>
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
 * The wrapper is the rounded rectangle; each row fills the full width and
 * inherits the rounded corners from the wrapper's `overflow-hidden`.
 * Odd-indexed rows get a tinted background so the alternating rhythm reads
 * at a glance.
 */
function ServerList({ servers }: { servers: ReadonlyArray<Server> }) {
  if (servers.length === 0) return null
  return (
    <ul className="overflow-hidden rounded-md border border-border/40">
      {servers.map((server, idx) => (
        <li
          key={server.id}
          className={cn(
            'bg-card/40',
            // Odd index → 2nd, 4th, ... → muted tint for contrast.
            idx % 2 === 1 && 'bg-muted/40',
          )}
        >
          <ServerRow server={server} />
        </li>
      ))}
    </ul>
  )
}

/** One server line — pulsing status dot plus the location name. */
function ServerRow({ server }: { server: Server }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* Pulsing status dot. Green = healthy, red = degraded. */}
      <ServerStatusDot status={server.status} />

      {/* Location label — server-specific name (e.g. "Frankfurt"). */}
      <span className="min-w-0 truncate text-sm font-medium">
        {server.location}
      </span>
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
 * Per-region server inventory. This file owns the static `location` +
 * `status` data only.
 *
 * Frankfurt (EU) and Chicago (NA) are both serving. APAC still declares
 * its reserved Singapore row, currently offline.
 */
const REGION_SERVERS: Record<ServerRegion['id'], ReadonlyArray<Server>> = {
  eu: [{ id: 'eu-fra', location: 'Frankfurt', status: 'online' }],
  na: [{ id: 'na-chi', location: 'Kansas City', status: 'online' }],
  apac: [{ id: 'apac-sin', location: 'Singapore', status: 'offline' }],
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
