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
 * The key is stored locally in `launcher-config.json` and is written
 * to `ClientConfig.ini` as `SessionId=` every time the game is
 * launched. No server validation is performed.
 */
export function AuthKeyModal({ open, onOpenChange, onSaved }: AuthKeyModalProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const inputId = useId()

  // Load the current saved key when the modal opens so we can show
  // the masked value.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const key = await window.launcherAPI.getAuthKey()
        if (!cancelled) setSavedKey(key ?? null)
      } catch {
        if (!cancelled) setSavedKey(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset the input field whenever the modal opens (so it starts blank),
  // but seed the value from the currently saved key if the user
  // re-opens without having saved anything new.
  useEffect(() => {
    if (!open) return
    setValue(savedKey ?? '')
    setIsSaving(false)
  }, [open, savedKey])

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await window.launcherAPI.setAuthKey(value.trim())
      setSavedKey(value.trim() || null)
      onSaved?.()
      onOpenChange(false)
    } catch {
      // Non-fatal — the input stays open so the user can retry.
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setIsSaving(true)
    try {
      await window.launcherAPI.setAuthKey('')
      setSavedKey(null)
      setValue('')
      onSaved?.()
      onOpenChange(false)
    } catch {
      // Non-fatal.
    } finally {
      setIsSaving(false)
    }
  }

  const isEmpty = value.trim().length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              disabled={isSaving}
              className="font-mono"
            />
          </div>

          {savedKey ? (
            <p className="text-xs text-muted-foreground">
              {t('authKey.currentKey')}{' '}
              <span className="font-mono">{maskKey(savedKey)}</span>
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {savedKey ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleClear()}
              disabled={isSaving}
            >
              {t('authKey.clear')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="gradient"
            onClick={() => void handleSave()}
            disabled={isEmpty || isSaving}
          >
            {t('authKey.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Show first 4 and last 4 chars of the key, masking the middle. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}
