import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { Spinner } from '@/components/ui/spinner'
import { ClanCard, type ClanCardData } from '@/components/clan/clan-card'
import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { fetchPublicApi } from '@/lib/public-api'
import { CLAN_API_BASE } from '@/lib/clan'
import type { ClanTooltipMember } from '@/lib/clan'

/**
 * Wire shape returned by `GET /v1/clans/:slug/tooltip`. Mirrors
 * the website's `ClanCardTooltipData` so both surfaces stay in
 * lock-step.
 */
export interface ClanTooltipData {
  slug: string
  name: string
  clantag: string
  description: string | null
  avatarUrl: string | null
  coverImageUrl: string | null
  isVerified: boolean
  memberCount: number
  followerCount: number
  topMembers: ClanTooltipMember[]
}

function tooltipUrl(slug: string): string {
  return `${CLAN_API_BASE}/${encodeURIComponent(slug)}/tooltip`
}

// Module-level cache so a second hover of the same clan tag in the
// same session — or a second tooltip instance pointing at the same
// slug — reuses the existing payload.
const dataCache = new Map<string, ClanTooltipData>()

/**
 * Tracks slugs that came back missing so we don't re-fire a doomed
 * request on every hover. Entries older than `NOT_FOUND_TTL_MS`
 * are treated as fresh misses and the next fetch hits the server
 * again.
 */
const notFoundCache = new Map<string, number>()
const NOT_FOUND_TTL_MS = 5_000

function isNotFoundCached(slug: string): boolean {
  const ts = notFoundCache.get(slug)
  if (ts === undefined) return false
  if (Date.now() - ts > NOT_FOUND_TTL_MS) {
    notFoundCache.delete(slug)
    return false
  }
  return true
}

const inflight = new Map<string, Promise<ClanTooltipData | null>>()

async function fetchClanTooltip(
  slug: string,
): Promise<ClanTooltipData | null> {
  if (isNotFoundCached(slug)) return null
  const cached = dataCache.get(slug)
  if (cached) return cached

  const existing = inflight.get(slug)
  if (existing) return existing

  const promise = (async () => {
    try {
      const res = await fetchPublicApi(tooltipUrl(slug))
      if (!res.ok) {
        if (res.status === 404) notFoundCache.set(slug, Date.now())
        return null
      }
      const body = (await res.json()) as ClanTooltipData | null
      if (body) {
        dataCache.set(slug, body)
        notFoundCache.delete(slug)
        return body
      }
      notFoundCache.set(slug, Date.now())
      return null
    } catch {
      return null
    } finally {
      inflight.delete(slug)
    }
  })()
  inflight.set(slug, promise)
  return promise
}

/**
 * Adapt the tooltip's wire shape (`clantag`) to the `<ClanCard>`
 * display shape (`tag`). Pure rename — same underlying row.
 */
function toClanCardData(d: ClanTooltipData): ClanCardData {
  return {
    slug: d.slug,
    name: d.name,
    tag: d.clantag,
    avatarUrl: d.avatarUrl,
    coverImageUrl: d.coverImageUrl,
    isVerified: d.isVerified,
    memberCount: d.memberCount,
    followerCount: d.followerCount,
    topMembers: d.topMembers,
  }
}

/**
 * Clan hover-card tooltip.
 *
 * Mirrors the website's `apps/web/components/clan-card-tooltip.tsx`
 * 1:1:
 *
 *   - Tooltip body rendered through `createPortal(... document.body)`
 *     so ancestor overflow contexts (`overflow-hidden` on a parent
 *     `<h1>`, the player profile's row container, etc.) never clip
 *     the hover card.
 *   - `framer-motion` `<motion.div>` with `initial` / `animate` /
 *     `exit` wrapped in `<AnimatePresence>` so the slide+fade plays
 *     on close instead of an instant unmount.
 *   - Positioning is computed manually from the trigger's
 *     `getBoundingClientRect()` and re-applied on scroll / resize,
 *     so we don't depend on Radix's anchor plumbing.
 *   - Open delay (200ms) / close delay (120ms) match the website.
 *   - Pre-fetch on mount so the data is almost always already in
 *     `dataCache` by the time the user hovers.
 *   - Body reuses the launcher's existing `<ClanCard>` so the
 *     hover preview is visually identical to the `/clans`
 *     directory cards — no parallel implementation to drift.
 *   - Module-level cache keyed by slug; second tooltip instance
 *     pointing at the same slug reuses the same payload.
 */
export function ClanCardTooltip({
  clan,
  size = 'default',
  className,
  children,
}: {
  /**
   * Minimal data already known at the trigger site. `name` is
   * used by the hover card body when present; the trigger
   * defaults to a clantag badge if no `children` are supplied.
   */
  clan: { slug: string; name?: string; clantag: string }
  /** Visual size of the default trigger badge. */
  size?: 'default' | 'sm' | 'lg'
  /** Extra classes forwarded to the *default* trigger badge. Ignored
   *  when `children` is supplied — the caller owns the trigger. */
  className?: string
  /** Optional override for the trigger. */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ClanTooltipData | null>(
    () => dataCache.get(clan.slug) ?? null,
  )
  const [loading, setLoading] = useState(false)
  /** True once the first fetch for this slug has completed. Used
   *  to render the "not found" fallback when the slug resolves to
   *  null — vs the skeleton (data still pending). */
  const [fetchAttempted, setFetchAttempted] = useState(false)

  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const openTimerRef = useRef<number>(0)
  const closeTimerRef = useRef<number>(0)
  const activeRef = useRef(true)

  /**
   * Pre-portal mount gate. `createPortal` against `document.body`
   * on the first render would crash during SSR (no document) and
   * would also leak the portal across hydration if the page
   * navigates client-side. Uses a lazy `useState` initializer so
   * the check runs exactly once.
   */
  const mounted = useState(() => typeof document !== 'undefined')[0]

  // Pre-fetch on mount, not on hover. Means the data is almost
  // always already in `dataCache` by the time the user actually
  // hovers, and the tooltip renders the full card on the first
  // hover rather than the skeleton.
  useEffect(() => {
    activeRef.current = true
    if (data) return

    fetchClanTooltip(clan.slug).then((result) => {
      if (!activeRef.current) return
      setLoading(true)
      setData(result)
      setLoading(false)
      setFetchAttempted(true)
    })
    return () => {
      activeRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clan.slug])

  const handleOpen = () => {
    clearTimeout(closeTimerRef.current)
    openTimerRef.current = window.setTimeout(() => setOpen(true), 200)
  }
  const handleClose = () => {
    clearTimeout(openTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120)
  }
  const handleCancelClose = () => {
    clearTimeout(closeTimerRef.current)
  }

  const trigger = children ?? (
    <ClantagBadge
      tag={clan.clantag}
      href={`#/clan/${clan.slug}`}
      size={size}
      className={className}
    />
  )

  const body = data ? (
    <ClanCard clan={toClanCardData(data)} />
  ) : loading || !fetchAttempted ? (
    <ClanCardTooltipSkeleton clantag={clan.clantag} />
  ) : (
    <ClanCardTooltipNotFound clantag={clan.clantag} slug={clan.slug} />
  )

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
        className="inline-flex"
      >
        {trigger}
      </span>
      {mounted
        ? createPortal(
            <PortalTooltip
              open={open}
              triggerRef={triggerRef}
              side="right"
              sideOffset={10}
              onMouseEnter={handleCancelClose}
              onMouseLeave={handleClose}
            >
              {body}
            </PortalTooltip>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Portal-rendered, position-tracked tooltip body.
 *
 * Reads the trigger's bounding rect on every open / scroll /
 * resize and translates the absolute-positioned motion.div to the
 * right edge of the trigger with a `sideOffset`. Mirrors the
 * website's `PortalTooltip`.
 */
function PortalTooltip({
  open,
  triggerRef,
  side = 'right',
  sideOffset = 10,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  open: boolean
  triggerRef: React.RefObject<HTMLSpanElement | null>
  side?: 'right' | 'left' | 'top' | 'bottom'
  sideOffset?: number
  onMouseEnter: (event: ReactMouseEvent<HTMLDivElement>) => void
  onMouseLeave: (event: ReactMouseEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  })

  useEffect(() => {
    if (!open) return
    function update() {
      const node = triggerRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const top = rect.top + window.scrollY
      let left = 0
      if (side === 'right') {
        left = rect.right + window.scrollX + sideOffset
      } else if (side === 'left') {
        left = rect.left + window.scrollX - sideOffset
      } else {
        left = rect.left + window.scrollX + rect.width / 2 - 160 // 320px / 2 (w-80)
      }
      setPosition({ top, left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, triggerRef, side, sideOffset])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          style={{
            position: 'absolute',
            top: position.top,
            left: position.left,
            zIndex: 50,
            width: '20rem', // w-80
          }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Skeleton matching the outer dimensions of `<ClanCard>` so the
 * tooltip doesn't jump when the data resolves. Mirrors the
 * website's `ClanCardTooltipSkeleton`.
 */
function ClanCardTooltipSkeleton({ clantag }: { clantag: string }) {
  return (
    <div className="flex w-80 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="relative mx-0.5 mt-0.5 h-20 rounded-md bg-muted" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="-mt-10 size-16 shrink-0 rounded-md bg-muted ring-3 ring-card sm:size-20" />
          <div className="flex flex-1 flex-col gap-2 pb-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Loading [{clantag}]…
            </div>
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}

/**
 * Fallback for slugs that don't resolve to a clan. Mirrors the
 * website's `ClanCardTooltipNotFound`.
 */
function ClanCardTooltipNotFound({
  clantag,
  slug,
}: {
  clantag: string
  slug: string
}) {
  return (
    <div className="flex w-80 flex-col items-center gap-3 overflow-hidden rounded-lg border bg-card p-6 text-center text-xs text-muted-foreground shadow-sm">
      <span>
        No info available for{' '}
        <span className="font-mono font-semibold text-foreground">
          [{clantag}]
        </span>
        .
      </span>
      <a
        href={`#/clan/${slug}`}
        className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
      >
        Open clan page →
      </a>
    </div>
  )
}
