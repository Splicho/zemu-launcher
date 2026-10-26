import { normalizeTier, type LeaderboardTier } from '@/lib/leaderboard'

const RANK_DATA: Record<LeaderboardTier, { medal: { src: string; w: number; h: number }; label: string }> = {
  bronze: {
    medal: { src: 'bronze/medal.png', w: 28, h: 28 },
    label: 'Bronze',
  },
  silver: {
    medal: { src: 'silver/medal.png', w: 28, h: 28 },
    label: 'Silver',
  },
  gold: {
    medal: { src: 'gold/medal.png', w: 28, h: 28 },
    label: 'Gold',
  },
  platinum: {
    medal: { src: 'platinum/medal.png', w: 28, h: 28 },
    label: 'Platinum',
  },
  diamond: {
    medal: { src: 'diamond/medal.png', w: 28, h: 28 },
    label: 'Diamond',
  },
  royalty: {
    medal: { src: 'royalty/medal.png', w: 36, h: 36 },
    label: 'Royalty',
  },
}

export function RankBadge({ tier, className }: { tier: LeaderboardTier; className?: string }) {
  // `normalizeTier` (rather than a bare `?? bronze`) so a tier the api
  // sends but we don't ship art for renders a valid badge instead of
  // throwing on `data.medal.src` and taking the whole table down.
  const data = RANK_DATA[normalizeTier(tier)]

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <img
        src={`/images/assets/ranks/${data.medal.src}`}
        alt={tier}
        width={data.medal.w}
        height={data.medal.h}
        className="h-5 w-5 object-contain"
      />
      <span className="text-xs font-semibold uppercase">{data.label}</span>
    </div>
  )
}
