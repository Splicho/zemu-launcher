import { Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PlayerProfile, PlayerSetup } from '@/lib/player-profile'

/**
 * Order of gear rows is intentional — it matches the order on the
 * account-settings form so a user looking at a profile can scan it
 * left-to-right against what they typed.
 */
const SETUP_ROWS: Array<{
  key: keyof PlayerSetup
  label: string
}> = [
  { key: 'monitor', label: 'Monitor' },
  { key: 'cpu', label: 'CPU' },
  { key: 'gpu', label: 'Graphics card' },
  { key: 'ram', label: 'Memory' },
  { key: 'keyboard', label: 'Keyboard' },
  { key: 'mouse', label: 'Mouse' },
  { key: 'mousepad', label: 'Mousepad' },
  { key: 'headset', label: 'Headset' },
]

/**
 * About tab on the public player profile. Mirrors the website's
 * `apps/web/app/player/[displayName]/components/player-about-tab.tsx`.
 *
 * Renders three blocks:
 *
 *  1. Join date (`{displayName} joined on {date}`).
 *  2. The player's gear, if any is published. Renders as a two-column
 *     list inside a card; rows where the value is null are skipped so
 *     a partial setup doesn't render as a wall of placeholders.
 *  3. A "Download useroptions.ini" card, if the player uploaded a file.
 *
 * When the player has published nothing at all the gear block is
 * hidden entirely.
 */
export function PlayerAboutTab({ profile }: { profile: PlayerProfile }) {
  const { displayName, joinedAt, setup, useroptionsIniUrl } = profile

  const visibleRows = setup
    ? SETUP_ROWS.filter((row) => {
        const value = setup[row.key]
        return typeof value === 'string' && value.trim().length > 0
      })
    : []

  const dpi = setup?.dpi
  const sensitivity = setup?.sensitivity
  const ingameResolution = setup?.ingameResolution

  const hasGear =
    visibleRows.length > 0 ||
    dpi != null ||
    sensitivity != null ||
    ingameResolution != null
  const hasIni = Boolean(useroptionsIniUrl)

  const joinDate = new Date(joinedAt)
  const joinDateLabel = Number.isNaN(joinDate.getTime())
    ? joinedAt
    : joinDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

  return (
    <div className="space-y-4">
      {/* Join date card */}
      <Card className="border-border/40 bg-transparent py-0">
        <div className="m-1 rounded-2xl bg-accent">
          <CardContent className="p-4">
            <h3 className="mb-2 text-xl text-foreground">
              About {displayName}
            </h3>
            <p className="text-muted-foreground">
              This player joined on {joinDateLabel}.
            </p>
          </CardContent>
        </div>
      </Card>

      {/* Gear card */}
      {hasGear ? (
        <Card className="border-border/40 bg-transparent py-0">
          <div className="m-1 rounded-2xl bg-accent">
            <CardContent className="space-y-4 p-4">
              <div>
                <h3 className="text-xl text-foreground">Game setup</h3>
                <p className="text-xs text-muted-foreground">
                  The hardware and peripherals {displayName} plays on.
                </p>
              </div>

              {visibleRows.length > 0 ? (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {visibleRows.map((row) => {
                    const value = setup?.[row.key]
                    if (typeof value !== 'string') return null
                    return (
                      <div key={row.key} className="space-y-0.5">
                        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {row.label}
                        </dt>
                        <dd className="text-sm">{value}</dd>
                      </div>
                    )
                  })}
                </dl>
              ) : null}

              {ingameResolution != null ||
              dpi != null ||
              sensitivity != null ? (
                <dl className="grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2">
                  {ingameResolution != null ? (
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Ingame resolution
                      </dt>
                      <dd className="text-sm tabular-nums">
                        {ingameResolution}
                      </dd>
                    </div>
                  ) : null}
                  {dpi != null ? (
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Mouse DPI
                      </dt>
                      <dd className="text-sm tabular-nums">{dpi}</dd>
                    </div>
                  ) : null}
                  {sensitivity != null ? (
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        In-game sensitivity
                      </dt>
                      <dd className="text-sm tabular-nums">
                        {sensitivity.toFixed(2)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </CardContent>
          </div>
        </Card>
      ) : null}

      {/* useroptions.ini card */}
      {hasIni && useroptionsIniUrl ? (
        <Card className="border-border/40 bg-transparent py-0">
          <div className="m-1 rounded-2xl bg-accent">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl text-foreground">useroptions.ini</h3>
                <p className="text-xs text-muted-foreground">
                  {displayName}&apos;s in-game keybind / settings file.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="self-start sm:self-auto"
                asChild
              >
                <a
                  href={useroptionsIniUrl}
                  download="useroptions.ini"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            </CardContent>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
