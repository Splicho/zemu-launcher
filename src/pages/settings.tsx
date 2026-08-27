import { useEffect, useState } from 'react'
import { DiscordFilled } from '@/components/icons'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

/**
 * User launcher settings.
 *
 * Persists launcher-wide preferences in `launcher-config.json`. The only
 *   field exposed today is the Discord Rich Presence opt-out.
 *
 * IPC contract on `window.discordAPI` (see `src/lib/tauri-bridge.ts`):
 *   - `getEnabled()` → Promise<boolean>
 *   - `setEnabled(boolean)` → void
 *
 * The Rust worker re-reads the flag on every queued command and on
 * every retry tick, so flipping the toggle takes effect within ~5s
 * without requiring a relaunch.
 *
 * The Discord activity buttons ("Website" + "Play") are hardcoded in
 * the Rust presence worker — Discord caps Rich Presence at 2 buttons,
 * so they don't belong in user-tunable settings.
 */
export function SettingsPage() {
  const [discordEnabled, setDiscordEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!window.discordAPI) return
    void window.discordAPI.getEnabled().then(setDiscordEnabled)
  }, [])

  const handleDiscordChange = (next: boolean) => {
    setDiscordEnabled(next)
    window.discordAPI?.setEnabled(next)
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">Launcher settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your launcher preferences. Changes save instantly and apply to every
          profile on this PC.
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <DiscordFilled className="size-6" />
          <h2 className="text-lg font-semibold">Discord Rich Presence</h2>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Show activity on Discord</span>
                <StatusPill enabled={discordEnabled === true} />
              </div>
              <p className="text-sm text-muted-foreground">
                Let your friends see what you're playing in Zemu. Requires Discord
                to be running on this PC. When enabled, your profile card links to
                the official Website and Play page.
              </p>
            </div>

            <Switch
              checked={discordEnabled ?? false}
              disabled={discordEnabled === null}
              onCheckedChange={handleDiscordChange}
              aria-label="Toggle Discord Rich Presence"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          This setting persists across restarts in your launcher configuration
          file.
        </p>
      </section>
    </div>
  )
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={
        enabled
          ? 'inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success'
          : 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
      }
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  )
}