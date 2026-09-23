import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

/**
 * Stat cards rendered on the player Overview tab.
 * Mirrors the website's `player-overview-tab.tsx`.
 *
 * All values are currently hardcoded to `N/A` because the launcher
 * has no live stats pipeline. The layout and placeholders are
 * preserved so the UI is ready when stats are wired up.
 */
const STAT_CARDS = [
  { label: 'K/D Ratio' },
  { label: 'Win Rate' },
  { label: 'Matches' },
  { label: 'Hours Played' },
] as const

export function PlayerOverviewTab() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAT_CARDS.map((stat) => (
          <Card
            key={stat.label}
            className="border-border/40 bg-transparent py-0"
          >
            <div className="m-1 rounded-2xl bg-accent">
              <CardContent className="flex flex-col gap-12 p-4">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {stat.label}
                </span>
                <span className="text-2xl font-semibold text-muted-foreground">
                  N/A
                </span>
              </CardContent>
            </div>
          </Card>
        ))}
      </div>

      {/*
        Chart stub. The website uses `EChartsAreaChart` from the
        workspace/ui chart components. The launcher has no equivalent
        yet, so this renders a placeholder card with the same visual
        weight as the website's chart so the tab doesn't jump when
        real data is wired up.
      */}
      <Card className="border-border/40 bg-transparent py-0">
        <div className="m-1 rounded-2xl bg-accent">
          <CardContent className="flex flex-col gap-4 p-4">
            <h3 className="text-xl text-foreground">Kills per match</h3>
            <div className="flex h-60 w-full items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Spinner className="size-6" />
                <span className="text-sm">Stats coming soon</span>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  )
}
