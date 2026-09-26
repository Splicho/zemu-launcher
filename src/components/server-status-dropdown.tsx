import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Europe } from '@/components/icons'
import { SERVERS, type ServerRegion } from '@/lib/server-status'

/**
 * Server-status pill anchored to the home-screen header.
 *
 * Sits to the LEFT of `<AccountDropdown />` (rendered before it
 * inside `Header`'s `justify-end` flex row). The trigger pill
 * matches the account dropdown's height (32 px) and is built as a
 * plain `<button>` so its outline + hover + focus-ring matches
 * the avatar trigger 1:1 — using the shared `<Button>` here gave
 * a visibly chunkier outline that didn't sit well in the header.
 *
 * The pill surfaces the default region's flag + label plus a
 * static green status dot. The launcher no longer probes the api
 * for a live player count, so the dot is decorative — it tells the
 * user which region the header is referring to without implying a
 * freshness signal that isn't being measured.
 *
 * Today only EU is wired in. The structure is region-array-driven
 * so NA + APAC can be added without changing the dropdown
 * implementation.
 */
export function ServerStatusDropdown() {
  const { t } = useTranslation()

  // Default region is the first entry in SERVERS (EU today).
  const defaultRegion = SERVERS[0]!

  // Only render a dropdown when there are other regions to switch to.
  // With a single-region setup the trigger is display-only.
  const hasSwitchableRegions = SERVERS.filter(
    (r) => r.id !== defaultRegion.id,
  ).length > 0

  // `useState` must be called unconditionally before any early returns.
  const [open, setOpen] = React.useState(false)

  if (!hasSwitchableRegions) {
    return (
      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3 text-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none"
      >
        <StatusDot />
        {renderRegionIcon(defaultRegion)}
        <span className="font-medium">{defaultRegion.label}</span>
      </button>
    )
  }

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
          <StatusDot />
          {renderRegionIcon(defaultRegion)}
          <span className="font-medium">{defaultRegion.label}</span>
          <ChevronDown
            className={
              'size-3.5 text-muted-foreground transition-transform ' +
              (open ? 'rotate-180' : '')
            }
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-40">
        {SERVERS.filter((r) => r.id !== defaultRegion.id).map((region) => (
          <ServerStatusRow key={region.id} region={region} />
        ))}
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

/**
 * Static green dot rendered next to each region's flag. Decorative —
 * the launcher no longer probes the api for a live player count, so
 * the dot no longer reflects a freshness signal. It's kept (with a
 * gentle pulse) so the pill still reads as "the launcher is alive
 * and aware of this region" rather than as a plain label.
 */
function StatusDot() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.7)]"
    />
  )
}

function ServerStatusRow({ region }: { region: ServerRegion }) {
  return (
    <DropdownMenuItem
      disabled
      className="flex items-center gap-2 truncate text-sm font-medium"
    >
      <StatusDot />
      {renderRegionIcon(region)}
      <span className="truncate">{region.label}</span>
    </DropdownMenuItem>
  )
}
