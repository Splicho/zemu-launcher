import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHashRouter } from '@/hooks/use-hash'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_LANGUAGES, normalizeLanguageCode, setPersistedLanguage } from '@/lib/i18n'
import { clearOnboardingCompleted } from '@/lib/onboarding'

export type DiscordRpcMode = 'always' | 'playing_only' | 'never'

const RPC_MODE_OPTIONS: { value: DiscordRpcMode; labelKey: string; descriptionKey: string }[] = [
  {
    value: 'always',
    labelKey: 'settings.general.rpcAlways',
    descriptionKey: 'settings.general.rpcAlwaysDesc',
  },
  {
    value: 'playing_only',
    labelKey: 'settings.general.rpcPlayingOnly',
    descriptionKey: 'settings.general.rpcPlayingOnlyDesc',
  },
]

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
export function GeneralPage() {
  const { t, i18n } = useTranslation()
  const { navigate } = useHashRouter()
  const [discordEnabled, setDiscordEnabled] = useState<boolean | null>(null)
  const [rpcMode, setRpcMode] = useState<DiscordRpcMode | null>(null)
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!window.discordAPI) return
    void window.discordAPI.getEnabled().then(setDiscordEnabled)
  }, [])

  useEffect(() => {
    if (!window.discordAPI) return
    void window.discordAPI.getMode().then((m) => setRpcMode(m as DiscordRpcMode))
  }, [])

  useEffect(() => {
    if (!window.launcherAPI) return
    void window.launcherAPI.getAutostartEnabled().then(setAutostartEnabled)
  }, [])

  const handleDiscordChange = (next: boolean) => {
    setDiscordEnabled(next)
    window.discordAPI?.setEnabled(next)
  }

  const handleModeChange = (next: DiscordRpcMode) => {
    setRpcMode(next)
    window.discordAPI?.setMode(next)
  }

  const handleAutostartChange = (next: boolean) => {
    setAutostartEnabled(next)
    window.launcherAPI?.setAutostartEnabled(next)
  }

  const handleLanguageChange = (code: string) => {
    setPersistedLanguage(code as typeof SUPPORTED_LANGUAGES[number]['code'])
    void i18n.changeLanguage(code)
  }

  const handleRerunSetup = () => {
    // Drop the "completed" flag so the gate re-routes the user into
    // the wizard at `#/onboarding`. The on-disk checks (key + folder +
    // base game) will pre-fill whichever steps are already satisfied.
    clearOnboardingCompleted()
    navigate('#/onboarding')
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">{t('settings.general.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.general.description')}
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t('settings.general.discordRichPresence')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.discordRichPresenceDesc')}
              </p>
            </div>

            <Switch
              checked={discordEnabled ?? false}
              disabled={discordEnabled === null}
              onCheckedChange={handleDiscordChange}
              aria-label={t('settings.general.discordRichPresence')}
            />
          </div>

          {discordEnabled === true && (
            <div className="mt-4 rounded-md border border-border/50 bg-muted/20 p-4">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('settings.general.activitySetting')}
              </Label>
              <RadioGroup
                className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
                value={rpcMode ?? 'always'}
                onValueChange={(v) => handleModeChange(v as DiscordRpcMode)}
              >
                {RPC_MODE_OPTIONS.map((opt) => (
                  <div
                    key={opt.value}
                    className="flex items-start gap-3 rounded-md border border-border bg-card p-3 cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => handleModeChange(opt.value)}
                  >
                    <RadioGroupItem value={opt.value} id={opt.value} />
                    <div className="flex flex-col gap-0.5">
                      <Label
                        htmlFor={opt.value}
                        className="cursor-pointer text-sm font-medium leading-tight"
                      >
                        {t(opt.labelKey)}
                      </Label>
                      <span className="text-xs text-muted-foreground leading-tight">
                        {t(opt.descriptionKey)}
                      </span>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t('settings.general.startOnStartup')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.startOnStartupDesc')}
              </p>
            </div>

            <Switch
              checked={autostartEnabled ?? false}
              disabled={autostartEnabled === null}
              onCheckedChange={handleAutostartChange}
              aria-label={t('settings.general.startOnStartup')}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t('settings.general.language')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.languageDesc')}
              </p>
            </div>

            <Select
              value={normalizeLanguageCode(i18n.language)}
              onValueChange={handleLanguageChange}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t('common.selectLanguage')} />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {t(lang.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t('settings.general.rerunSetup')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.rerunSetupDesc')}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleRerunSetup}
              aria-label={t('settings.general.rerunSetup')}
            >
              {t('settings.general.rerunSetup')}
            </Button>
          </div>
        </div>

      </section>
    </div>
  )
}
