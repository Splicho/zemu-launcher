import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

const BANNER_BACKGROUND = '/background/leaderboard-banner-bg.png'

/**
 * Leaderboard page banner.
 *
 * `leaderboard-banner-bg.png` (972×66) is the whole surface — stretched to
 * the page width, exactly like the footer's notice banner uses
 * `notice-bar-bg.png` — and the page title is painted on top of it.
 *
 * Replaces the old full-bleed `season-banner.jpg` hero, which took
 * 250–320px of vertical space (and said "Playtests" rather than naming the
 * page). This keeps a branded strip at the same 66px height as the notice
 * bar and carries the title, so the page needs no second heading below.
 *
 * It is rendered *inside* the page's content column (the caller supplies
 * the horizontal inset and the corner radius), so its edges line up with
 * the filter bar and the table instead of spanning the window.
 */
export function LeaderboardBanner({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden px-5',
        className,
      )}
      style={{
        backgroundImage: `url(${BANNER_BACKGROUND})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        width: '100%',
        height: '66px'
      }}
    >
      <h1 className="text-md font-bold uppercase leading-none text-white">
        {t('leaderboardPage.title')}
      </h1>
    </div>
  )
}
