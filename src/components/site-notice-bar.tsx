import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'
import { toast } from 'sonner'

import { useSiteNotice } from '@/hooks/use-site-notice'
import type { SiteNotice } from '@/lib/site-notice'

/**
 * Launcher notice bar — the `launcher` surface of the admin-managed
 * site notice.
 *
 * Sits directly below `<TitleBar />` in `main-app.tsx`, above
 * `MainLayout`. Two consequences of that placement are deliberate:
 *
 *  1. **It owns the full window width, not the content column.**
 *     `MainLayout` puts the sidebar to the left of everything else;
 *     rendering the bar inside it would start the bar at the
 *     sidebar's right edge and leave a dead notch above the nav. A
 *     notice is a window-level message, so it reads as one.
 *  2. **Nothing else has to compensate for its height.** The website
 *     needed a `--site-notice-h` CSS variable plus a `margin-top` on
 *     a wrapper because its header is `position: fixed` and ten
 *     pages hardcoded `pt-14`. Here the bar is a `flex` child of the
 *     window's root column, so the flexbox already pushes everything
 *     below it down. There is no offset to keep in sync, which is
 *     why this bar is allowed to wrap to two lines on a narrow
 *     window instead of truncating.
 *
 * The bar mounts regardless of auth state: a notice like "the servers
 * are down for maintenance" is exactly what a signed-out visitor
 * needs to see before they can sign in, and the endpoint is
 * unauthenticated anyway. Mounting it inside `MainLayout` would have
 * hidden it on the login page for no benefit.
 *
 * Dismissal is per-notice and survives restarts — the key is
 * `zemu-launcher.siteNotice.dismissed.<id>`, so dismissing today's
 * maintenance notice does not hide tomorrow's. Publishing a new
 * notice (new id) re-shows the bar for everyone, including users who
 * dismissed every previous one.
 */

/**
 * Dismissal keys are namespaced under `zemu-launcher.*` to match
 * `use-last-used-provider.ts` and `lib/i18n.ts`, so a "clear site
 * data" story stays coherent across the app.
 */
const DISMISS_KEY_PREFIX = 'zemu-launcher.siteNotice.dismissed.'

/**
 * Fixed bar height, kept in sync with nothing else — the launcher's
 * layout is a flex column, so the bar's height is whatever it
 * renders. Capped so a pathological notice can't eat the window.
 */
const MAX_TEXT_LINES = 2

/** `variant` -> design-system tokens. `alert` maps to `destructive`, matching the website. */
const VARIANT_CLASS: Record<SiteNotice['variant'], string> = {
  success: 'bg-success text-success-foreground',
  alert: 'bg-destructive text-destructive-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
}

export function SiteNoticeBar() {
  const { t } = useTranslation()
  const { notice } = useSiteNotice()
  const [dismissed, setDismissed] = useState(false)

  // Read the dismissal flag after mount, in an effect rather than
  // during render. `localStorage` is only readable on the client, and
  // the launcher's bundle is client-only — but reading it in render
  // still means the first paint can disagree with what the user last
  // chose, which is the flash this avoids.
  useEffect(() => {
    if (!notice) {
      setDismissed(false)
      return
    }
    try {
      setDismissed(
        window.localStorage.getItem(`${DISMISS_KEY_PREFIX}${notice.id}`) === '1',
      )
    } catch {
      // Private browsing / storage disabled — treat as not dismissed.
      setDismissed(false)
    }
  }, [notice])

  const dismiss = useCallback(() => {
    if (!notice) return
    setDismissed(true)
    try {
      window.localStorage.setItem(`${DISMISS_KEY_PREFIX}${notice.id}`, '1')
    } catch {
      // Non-fatal: the bar still hides for this session.
    }
  }, [notice])

  const visible = notice !== null && !dismissed

  return (
    // Kept mounted (via AnimatePresence) so a dismissal animates out
    // instead of the bar vanishing between two layout passes.
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key={notice.id}
          role="status"
          aria-live="polite"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`shrink-0 overflow-hidden ${VARIANT_CLASS[notice.variant]}`}
        >
          {/* `1fr auto 1fr` centres the middle cell and keeps it
              centred whatever sits in the trailing cell. A plain
              `justify-center` flex row would only look centred when
              the right cell is empty — one button shifts the optical
              centre left, and the shift grows with that button's
              width. The two equal `1fr` gutters absorb the trailing
              cell's cost, so the middle cell stays put at any window
              width. The leading cell is an empty spacer for the same
              reason: without it the copy would land in the first
              column and sit off-centre. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-6 py-2.5 sm:px-8">
            <span aria-hidden="true" />
            {/* Centre cell: the copy and its link travel together as
                one group. Keeping the link inside this cell is what
                puts it hard against the last word — in the trailing
                cell it was stranded at the far edge, separated from
                the text by however much slack the `1fr` had left over,
                which reads as two unrelated things on one bar. */}
            <div className="flex min-w-0 items-start justify-center gap-2">
              <p
                className="min-w-0 text-center text-sm font-medium"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: MAX_TEXT_LINES,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {notice.text}
              </p>
              {notice.linkUrl ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 pt-px text-sm font-semibold underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
                  onClick={() => {
                    // `openUrl` hands the URL to the OS browser rather
                    // than the webview — the same path the sidebar's
                    // external links use. A notice link pointing at a
                    // long article should not replace the launcher.
                    const href = notice.linkUrl
                    if (!href) return
                    void openUrl(href).catch((error) => {
                      toast.error(t('common.error'), { description: String(error) })
                    })
                  }}
                >
                  {notice.linkLabel ?? 'Read more'}
                  {/* `aria-hidden` because the label already carries
                      the meaning; announcing "arrow right" as well
                      just makes screen readers say it twice. Decorative
                      reinforcement, not new information. */}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {/* Trailing cell: dismiss only, hard right so the bar
                still closes the way a bar is expected to. */}
            <div className="flex items-start justify-self-end">
              {notice.isDismissible ? (
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label={t('siteNotice.dismiss')}
                  className="-mr-1 shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
