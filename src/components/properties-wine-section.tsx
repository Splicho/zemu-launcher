import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCog, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { WineConfig, WineEnvVar, WineRuntime } from '@/lib/tauri-bridge'

const AUTO_RUNTIME = 'auto'
const CUSTOM_RUNTIME = 'custom'

const DEFAULT_CONFIG: WineConfig = {
  enabled: false,
  runtimeId: null,
  customRuntimePath: null,
  winePrefix: null,
  env: [],
}

export function WineSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<WineConfig>(DEFAULT_CONFIG)
  const [runtimes, setRuntimes] = useState<WineRuntime[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runtimeValue = config.runtimeId ?? AUTO_RUNTIME
  const selectedRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === config.runtimeId),
    [config.runtimeId, runtimes],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      window.wineAPI.getConfig(),
      window.wineAPI.listRuntimes(),
    ])
      .then(([storedConfig, detectedRuntimes]) => {
        if (cancelled) return
        setConfig({ ...DEFAULT_CONFIG, ...storedConfig })
        setRuntimes(detectedRuntimes)
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(formatError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateConfig = (next: Partial<WineConfig>) => {
    setConfig((current) => ({ ...current, ...next }))
    setDirty(true)
  }

  const refreshRuntimes = async () => {
    setError(null)
    try {
      setRuntimes(await window.wineAPI.listRuntimes())
    } catch (err) {
      setError(formatError(err))
    }
  }

  const save = async () => {
    if (saving || !loaded) return
    setSaving(true)
    setError(null)
    try {
      const saved = await window.wineAPI.saveConfig(config)
      setConfig({ ...DEFAULT_CONFIG, ...saved })
      setDirty(false)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(false)
    }
  }

  const selectPrefix = async () => {
    try {
      const path = await window.wineAPI.selectPrefixDirectory()
      if (path) updateConfig({ winePrefix: path })
    } catch (err) {
      setError(formatError(err))
    }
  }

  const selectCustomRuntime = async () => {
    try {
      const path = await window.wineAPI.selectRuntimeExecutable()
      if (path) updateConfig({ runtimeId: CUSTOM_RUNTIME, customRuntimePath: path })
    } catch (err) {
      setError(formatError(err))
    }
  }

  const setEnvAt = (index: number, patch: Partial<WineEnvVar>) => {
    updateConfig({
      env: config.env.map((entry, currentIndex) =>
        currentIndex === index ? { ...entry, ...patch } : entry,
      ),
    })
  }

  const removeEnvAt = (index: number) => {
    updateConfig({
      env: config.env.filter((_, currentIndex) => currentIndex !== index),
    })
  }

  const addEnv = () => {
    updateConfig({
      env: [...config.env, { key: '', value: '' }],
    })
  }

  return (
    <fieldset disabled={loading || saving || !loaded} className="min-w-0 space-y-5">
      <div className="flex items-start justify-between gap-6 rounded-md border border-border bg-card p-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t('properties.wineEnable')}</Label>
          <p className="text-sm text-muted-foreground">{t('properties.wineEnableDesc')}</p>
        </div>
        <Switch
          checked={config.enabled}
          disabled={loading}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
          aria-label={t('properties.wineEnable')}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="wine-runtime">{t('properties.wineRuntime')}</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshRuntimes()}>
            <RefreshCw />
            {t('properties.refresh')}
          </Button>
        </div>

        <Select
          value={runtimeValue}
          disabled={!config.enabled || loading}
          onValueChange={(value) => {
            updateConfig({
              runtimeId: value === AUTO_RUNTIME ? null : value,
            })
          }}
        >
          <SelectTrigger id="wine-runtime">
            <SelectValue placeholder={t('properties.wineRuntimePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_RUNTIME}>{t('properties.wineRuntimeAuto')}</SelectItem>
            {runtimes.map((runtime) => (
              <SelectItem key={runtime.id} value={runtime.id}>
                {runtime.name}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_RUNTIME}>{t('properties.wineRuntimeCustom')}</SelectItem>
          </SelectContent>
        </Select>

        {selectedRuntime ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="rounded-sm uppercase">
              {selectedRuntime.kind}
            </Badge>
            <span className="truncate font-mono" title={selectedRuntime.path}>
              {selectedRuntime.path}
            </span>
          </div>
        ) : null}

        {runtimeValue === CUSTOM_RUNTIME ? (
          <div className="flex gap-2">
            <Input
              value={config.customRuntimePath ?? ''}
              onChange={(event) => updateConfig({ customRuntimePath: event.target.value })}
              placeholder={t('properties.wineCustomRuntimePlaceholder')}
              disabled={!config.enabled}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void selectCustomRuntime()}
              disabled={!config.enabled}
              aria-label={t('properties.browse')}
            >
              <FileCog />
            </Button>
          </div>
        ) : null}

        {!loading && runtimes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('properties.wineNoRuntimes')}</p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <Label htmlFor="wine-prefix">{t('properties.winePrefix')}</Label>
        <div className="flex gap-2">
          <Input
            id="wine-prefix"
            value={config.winePrefix ?? ''}
            onChange={(event) => updateConfig({ winePrefix: event.target.value })}
            placeholder={t('properties.winePrefixPlaceholder')}
            disabled={!config.enabled}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void selectPrefix()}
            disabled={!config.enabled}
            aria-label={t('properties.browse')}
          >
            <FolderOpen />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('properties.winePrefixDesc')}</p>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <Label>{t('properties.wineEnv')}</Label>
          <Button type="button" variant="outline" size="sm" onClick={addEnv} disabled={!config.enabled}>
            <Plus />
            {t('properties.addVariable')}
          </Button>
        </div>
        <div className="space-y-2">
          {config.env.map((entry, index) => (
            <div key={index} className="grid grid-cols-[minmax(8rem,0.65fr)_1fr_2rem] gap-2">
              <Input
                value={entry.key}
                onChange={(event) => setEnvAt(index, { key: event.target.value })}
                placeholder={t('properties.envKey')}
                disabled={!config.enabled}
              />
              <Input
                value={entry.value}
                onChange={(event) => setEnvAt(index, { value: event.target.value })}
                placeholder={t('properties.envValue')}
                disabled={!config.enabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeEnvAt(index)}
                disabled={!config.enabled}
                aria-label={t('properties.removeVariable')}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {config.env.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('properties.wineEnvEmpty')}</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex justify-end border-t border-border bg-background p-4">
        <Button type="button" variant="gradient" onClick={() => void save()} disabled={loading || saving || !loaded || !dirty}>
          {saving ? t('properties.saving') : t('common.save')}
        </Button>
      </div>
    </fieldset>
  )
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
