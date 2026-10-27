import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { openUrl } from '@tauri-apps/plugin-opener'

import { useSiteNotice } from '@/hooks/use-site-notice'
import { cn } from '@/lib/utils'

/**
 * Footer notice banner — new launcher UI.
 *
 * Uses `notice-bar-bg.png` (717×66) as the whole surface: the image is
 * stretched to the 60% footer column and the notice copy is painted on
 * top of it. Nothing from the legacy `SiteNoticeBar` chrome is reused —
 * no variant colours, no dismiss button, only the notice contents.
 *
 * Rendered conditionally: `useSiteNotice` resolves to `null` while
 * loading, on a failed fetch, and when nothing is live, and the banner
 * renders nothing in all three cases so the right column simply stays
 * empty instead of reserving space for an absent bar.
 *
 * The link (when the notice has one) opens in the OS browser through
 * `plugin-opener`, same as the sidebar's social links — a notice link
 * should not navigate the launcher webview away from the app.
 */
const NOTICE_BACKGROUND = '/notice-bar/notice-bar-bg.png'

export function NoticeBanner({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { notice } = useSiteNotice()

  if (!notice) return null

  const handleLinkClick = () => {
    const href = notice.linkUrl
    if (!href) return
    void openUrl(href).catch((error) => {
      toast.error(t('common.error'), { description: String(error) })
    })
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex h-[66px] w-full items-center gap-4 px-6', className)}
      style={{
        backgroundImage: `url(${NOTICE_BACKGROUND})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <p className="line-clamp-2 min-w-0 text-sm font-semibold uppercase leading-snug text-white">
        {notice.text}
      </p>
      {notice.linkUrl ? (
        <button
          type="button"
          onClick={handleLinkClick}
          className={cn(
            'shrink-0 text-sm font-semibold text-white underline underline-offset-4',
            'transition-opacity duration-150 hover:no-underline hover:opacity-90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
          )}
        >
          {notice.linkLabel ?? 'Read more'}
        </button>
      ) : null}
    </div>
  )
}
