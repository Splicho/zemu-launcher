import { useEffect, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

/**
 * User launcher settings.
 *
 * Exposes two opt-in/opt-out toggles:
 *   - Discord Rich Presence — persisted in `launcher-config.json` via
 *     `window.discordAPI`. The Rust worker re-reads the flag on every
 *     queued command and on every retry tick, so flipping the toggle
 *     takes effect within ~5s without a relaunch.
 *   - Start ZEmu Launcher on startup — managed directly by the OS via
 *     `tauri-plugin-autostart` (e.g. `HKCU\...\Run` on Windows). We do
 *     not cache the value in `launcher-config.json`; the toggle always
 *     reads the real OS state on mount so it recovers correctly even
 *     if the user changes the entry in Task Manager > Startup.
 *
 * The Discord activity buttons ("Website" + "Play") are hardcoded in
 * the Rust presence worker — Discord caps Rich Presence at 2 buttons,
 * so they don't belong in user-tunable settings.
 */
export function SettingsPage() {
  const [discordEnabled, setDiscordEnabled] = useState<boolean | null>(null)
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!window.discordAPI) return
    void window.discordAPI.getEnabled().then(setDiscordEnabled)
  }, [])

  useEffect(() => {
    if (!window.launcherAPI) return
    void window.launcherAPI.getAutostartEnabled().then(setAutostartEnabled)
  }, [])

  const handleDiscordChange = (next: boolean) => {
    setDiscordEnabled(next)
    window.discordAPI?.setEnabled(next)
  }

  const handleAutostartChange = (next: boolean) => {
    setAutostartEnabled(next)
    window.launcherAPI?.setAutostartEnabled(next)
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          General launcher preferences.
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Discord Rich Presence</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Show your activity on discord when you are in the launcher or in-game.
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

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Start ZEmu Launcher on startup</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Automatically launch ZEmu when you sign in to Windows.
              </p>
            </div>

            <Switch
              checked={autostartEnabled ?? false}
              disabled={autostartEnabled === null}
              onCheckedChange={handleAutostartChange}
              aria-label="Toggle launch on system startup"
            />
          </div>
        </div>

      </section>
    </div>
  )
}
