import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a key is successfully saved. */
  onSaved?: () => void
}

/**
 * Standalone modal for entering and saving the user's auth key.
 *
 * The key is stored locally in `launcher-config.json` and passed as
 * the `SessionId=` command-line argument every time the game is
 * launched. No server validation is performed.
 */
export function AuthKeyModal({ open, onOpenChange, onSaved }: AuthKeyModalProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const inputId = useId()

  // Disable editing until the saved key arrives, so a slow disk read
  // cannot overwrite a key the user has already started typing.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setValue('')
    setSavedKey(null)
    window.launcherAPI.getAuthKey()
      .then((key) => {
        if (cancelled) return
        setSavedKey(key ?? null)
        setValue(key ?? '')
      })
      .catch(() => {
        if (!cancelled) setError(t('authKey.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [open, t])

  const handleSave = async () => {
    if (isSaving || isLoading || !value.trim()) return
    setIsSaving(true)
    setError(null)
    try {
      await window.launcherAPI.setAuthKey(value.trim())
      setSavedKey(value.trim() || null)
      onSaved?.()
      onOpenChange(false)
    } catch {
      setError(t('authKey.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    if (isSaving || isLoading) return
    setIsSaving(true)
    setError(null)
    try {
      await window.launcherAPI.setAuthKey('')
      setSavedKey(null)
      setValue('')
      onSaved?.()
      onOpenChange(false)
    } catch {
      setError(t('authKey.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const isEmpty = value.trim().length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('authKey.modalTitle')}</DialogTitle>
          <DialogDescription>{t('authKey.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={inputId}>{t('authKey.inputLabel')}</Label>
            <Input
              id={inputId}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t('authKey.placeholder')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isEmpty) {
                  void handleSave()
                }
              }}
              disabled={isSaving || isLoading}
              className="font-mono"
            />
          </div>
        </div>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {savedKey ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleClear()}
              disabled={isSaving || isLoading}
            >
              {t('authKey.clear')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="gradient"
            onClick={() => void handleSave()}
            disabled={isEmpty || isSaving || isLoading}
          >
            {t('authKey.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
