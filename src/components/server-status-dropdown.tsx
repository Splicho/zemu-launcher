import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Europe } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { useServerStatus } from '@/hooks/use-server-status'
import {
  SERVERS,
  getInternalApiKey,
  type ServerRegion,
} from '@/lib/server-status'

/**
 * Server-status dropdown anchored to the home-screen header.
 *
 * Sits to the LEFT of `<AccountDropdown />` (rendered before it
 * inside `Header`'s `justify-end` flex row). The trigger pill
 * matches the account dropdown's height (32 px) and is built as a
 * plain `<button>` so its outline + hover + focus-ring matches
 * the avatar trigger 1:1 — using the shared `<Button>` here gave
 * a visibly chunkier outline that didn't sit well in the header.
 *
 * The pill surfaces the default region's live player count plus
 * a green/red status dot (pulsing when the upstream is reachable,
 * solid red when the api's `source === 'unavailable'` or the
 * fetch errored). Clicking it opens a small menu listing every
 * declared server region with the same status-dot + count
 * treatment per row.
 *
 * Today only EU is wired in. The structure is region-array-driven
 * so NA + APAC can be added without changing the dropdown
 * implementation.
 */
export function ServerStatusDropdown() {
  const { t } = useTranslation()
  const hasKey = getInternalApiKey().length > 0
  const configured = hasKey && SERVERS.some((s) => s.playercountUrl !== null)

  // Default region is the first entry in SERVERS (EU today). Its
  // count + status drive the trigger pill so the home screen
  // surfaces the most relevant playercount without forcing the
  // user to open the menu.
  const defaultRegion = SERVERS[0]!
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('serverStatus.openMenu')}
          // Match the account dropdown trigger: plain `<button>`
          // (no native outline / background / padding) with the
          // shared focus-visible ring, full pill radius, and the
          // 32 px height of `<Avatar>` default size.
          //
          // We intentionally drop `focus-visible:ring-*` here
          // because Radix returns focus to the trigger after the
          // menu closes, and Chromium's `:focus-visible` heuristic
          // treats that keyboard-managed focus as "focus-visible"
          // — leaving the ring stuck on the trigger indefinitely.
          // The pill already has a `border` + `hover` state which
          // is enough affordance; the avatar trigger keeps its
          // ring because it never closes a popover.
          className="flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3 text-sm transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground focus:outline-none focus-visible:outline-none"
        >
          <StatusDot region={defaultRegion} />
          {renderRegionIcon(defaultRegion)}
          <span className="font-medium">{defaultRegion.label}</span>
          <DefaultRegionCount region={defaultRegion} />
          <ChevronDown
            className={
              'size-3.5 text-muted-foreground transition-transform ' +
              (open ? 'rotate-180' : '')
            }
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-40">
        {!configured ? (
          <ServerStatusNotConfiguredRow />
        ) : (
          SERVERS.map((region) => (
            <ServerStatusRow key={region.id} region={region} />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Flag badge rendered after the `<StatusDot>` in the trigger pill.
 * Wrapped in a circular clip so the rectangular SVG renders as a
 * fully-rounded country avatar. Falls back to nothing if the region
 * didn't ship a flag component (future NA/APAC slots will plug in
 * here).
 */
function renderRegionIcon(region: ServerRegion) {
  if (region.id === 'eu') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full"
      >
        <Europe
          // Force the SVG to fill the wrapper. The raw `<Europe>`
          // component renders `width="1.34em" height="1em"` as
          // presentation attributes; in some browsers those leak
          // through Tailwind's `size-full` rule and the wrapper
          // ends up clipping a non-square flag. Explicit `100%`
          // attributes are honored by the SVG renderer and win.
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
          className="block size-full"
        />
      </span>
    )
  }
  return null
}

type ServerStatusState = 'live' | 'unavailable' | 'pending'

/**
 * Resolve the trigger's status from the underlying query. Three
 * buckets, ordered worst-to-best:
 *   - `unavailable`: fetch errored OR data.source === 'unavailable'
 *                    OR data.ok === false. Rendered as a solid red
 *                    dot — the user can see at a glance the server
 *                    is unreachable.
 *   - `pending`:     still on the first fetch, no data yet. Rendered
 *                    as a gray static dot so the user sees the
 *                    status indicator is there but isn't yet
 *                    authoritative.
 *   - `live`:        fresh data (source 'live' or 'cache'), ok=true.
 *                    Rendered as a green pulsing dot.
 */
function useServerStatusState(region: ServerRegion): ServerStatusState {
  const query = useServerStatus(region)
  if (query.isPending && !query.data) return 'pending'
  if (query.isError) return 'unavailable'
  const data = query.data
  if (!data || !data.ok || data.source === 'unavailable') {
    return 'unavailable'
  }
  return 'live'
}

function StatusDot({ region }: { region: ServerRegion }) {
  const state = useServerStatusState(region)
  return (
    <span
      aria-hidden="true"
      // 8 px circle. `animate-pulse` is a built-in Tailwind keyframe
      // (opacity 100 → 50 → 100, ~2 s cycle). The pulse only fires
      // in the `live` and `unavailable` states so the user gets a
      // heartbeat only when the upstream status is meaningful —
      // pending stays static to avoid implying online-ness before
      // we've actually heard back from the api.
      className={
        'inline-block size-2 rounded-full ' +
        (state === 'live'
          ? 'bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.7)]'
          : state === 'unavailable'
            ? 'bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.7)]'
            : 'bg-muted-foreground/60')
      }
    />
  )
}

/**
 * Live count baked into the trigger pill so the home-screen header
 * surfaces the most relevant region's playercount without opening
 * the menu. Mirrors the same "unavailable / not configured"
 * semantics as the row itself, and renders the count inside a
 * `<Badge>` so it reads as a chip rather than a bare number —
 * which keeps the trigger visually grouped (icon · label · count)
 * and gives the count its own bounded block against the pill's
 * neutral background.
 */
function DefaultRegionCount({ region }: { region: ServerRegion }) {
  const query = useServerStatus(region)
  const placeholder = '—'

  let displayCount: string
  if (query.isPending && !query.data) {
    displayCount = placeholder
  } else if (
    query.isError ||
    !query.data ||
    !query.data.ok ||
    query.data.source === 'unavailable'
  ) {
    displayCount = placeholder
  } else {
    displayCount = query.data.total.toLocaleString()
  }

  const isPlaceholder = displayCount === placeholder

  return (
    <Badge
      variant="secondary"
      className="rounded-sm!"
    >
      {query.isPending && !query.data ? (
        <Spinner className="size-3" />
      ) : null}
      <span className={isPlaceholder ? 'text-muted-foreground' : 'text-foreground'}>
        {displayCount}
      </span>
    </Badge>
  )
}

function ServerStatusNotConfiguredRow() {
  const { t } = useTranslation()
  return (
    <DropdownMenuItem disabled className="flex flex-col items-start gap-0.5">
      <span className="text-sm font-medium">
        {t('serverStatus.notConfiguredTitle')}
      </span>
      <span className="text-xs text-muted-foreground">
        {t('serverStatus.notConfiguredDetail')}
      </span>
    </DropdownMenuItem>
  )
}

function ServerStatusRow({
  region,
}: {
  region: ServerRegion
}) {
  const query = useServerStatus(region)
  const count = query.data
  const placeholder = '—'

  let displayCount: string
  if (query.isPending && !count) {
    displayCount = placeholder
  } else if (
    query.isError ||
    !count ||
    !count.ok ||
    count.source === 'unavailable'
  ) {
    displayCount = placeholder
  } else {
    displayCount = count.total.toLocaleString()
  }

  return (
    <DropdownMenuItem
      disabled
      className="flex items-center justify-between gap-3"
    >
      <span className="flex items-center gap-2 truncate text-sm font-medium">
        <StatusDot region={region} />
        {renderRegionIcon(region)}
        <span className="truncate">{region.label}</span>
      </span>
      <Badge variant="outline">
        {query.isPending && !count ? (
          <Spinner className="size-3" />
        ) : null}
        <span
          className={
            displayCount === placeholder
              ? 'text-muted-foreground'
              : 'text-foreground'
          }
        >
          {displayCount}
        </span>
      </Badge>
    </DropdownMenuItem>
  )
}
