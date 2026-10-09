import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui/spinner'
import type { MatchData } from '@/lib/leaderboard'

function formatNumber(value?: number): string {
  if (value === undefined) return '-'
  return value.toLocaleString()
}

function MatchColumn({ match }: { match: MatchData }) {
  const placement = String(match.placement ?? 0).padStart(2, '0')
  return (
    <div className="flex w-[80px] shrink-0 flex-col items-center justify-start gap-1.5 py-2 sm:gap-2 sm:py-3">
      <img
        src={`/images/assets/progression/Level_progression${placement}.png`}
        alt={`Placement ${match.placement}`}
        width={80}
        height={80}
        className="object-contain"
      />
      <div className="relative flex h-7 w-full items-center justify-center sm:h-8">
        <img
          src="/images/assets/kill-back.png"
          alt=""
          width={72}
          height={40}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 z-0 h-full w-[60px] -translate-x-1/2 -translate-y-1/2 object-contain sm:w-[68px]"
        />
        <div className="relative z-10 flex items-center gap-1">
          <img
            src="/images/assets/skull-crosshair.png"
            alt="Kills"
            width={24}
            height={24}
            className="h-3.5 w-3.5 object-contain sm:h-4 sm:w-4"
          />
          <span className="text-xs font-semibold text-white tabular-nums sm:text-sm">
            {formatNumber(match.kills)}
          </span>
        </div>
      </div>
      <span className="text-xs font-semibold tabular-nums sm:text-sm">
        {formatNumber(match.score)}
      </span>
    </div>
  )
}

export function PlayerGames({
  matches,
  isLoading,
}: {
  matches: MatchData[]
  isLoading?: boolean
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6">
        <Spinner className="size-5" aria-hidden />
        <span className="text-sm text-foreground/70">
          {t('leaderboardPage.expandingLoading')}
        </span>
      </div>
    )
  }

  if (!matches.length) {
    return (
      <p className="py-4 text-center text-sm text-foreground/70">
        {t('leaderboardPage.expandingEmpty')}
      </p>
    )
  }

  return (
    <div className="flex items-start justify-center gap-2 py-3 sm:gap-3 sm:py-4">
      {/* 10 match columns */}
      <div className="flex items-start gap-2 sm:gap-3">
        {matches.slice(0, 10).map((match, index) => (
          <MatchColumn key={index} match={match} />
        ))}
      </div>
    </div>
  )
}
