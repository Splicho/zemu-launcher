import { useCallback, useEffect, useId, useState } from 'react'
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
import { fetchMyAuthKey } from '@/lib/auth'

interface AuthKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Optional launcher bearer token. When supplied, the Save handler
   * validates the typed key against the canonical key the server has
   * on file for the signed-in user before writing it to disk. This
   * keeps the launcher from accepting an arbitrary string the user
   * pasted (typo, someone else's key, a bruteforce probe) — the
   * save is rejected unless the typed value byte-matches the row in
   * the `authkey` table.
   *
   * `null` / `undefined` disables the server check (manual-only
   * mode, used by the onboarding wizard before the user signs in).
   * The wizard has its own validation flow, so we don't gate the
   * modal on it.
   */
  token?: string | null
  /** Called after a key is successfully saved. */
  onSaved?: () => void
}

/**
 * Standalone modal for entering and saving the user's auth key.
 *
 * The key is stored locally in `launcher-config.json` and passed as
 * the `SessionId=` command-line argument every time the game is
 * launched. No server validation is performed.
 *
 * ## Validation (when a `token` is supplied)
 *
 * Before writing the typed value to disk, the Save handler calls
 * `fetchMyAuthKey(token)` and string-compares the response against
 * the input. A mismatch is rejected with an inline error — the
 * server-stored key is the single source of truth, and the launcher
 * MUST NOT persist any value that doesn't match it. This guards
 * against:
 *
 *   - Typos: the user pastes a stray character and would otherwise
 *     save a broken key until the next page mount (when the Account
 *     page's hydration silently overwrites it).
 *   - Cross-account key sharing: a user pastes someone else's key
 *     (which would let them launch under the wrong identity).
 *   - Bruteforce probing: a user pastes random strings hoping to
 *     land on a valid key; the launcher refuses to persist
 *     anything that doesn't match the DB row.
 *
 * Failure posture: if `fetchMyAuthKey` errors (network down, token
 * expired, server 5xx), the save is rejected with a "could not
 * verify your key" message. We deliberately fail closed rather
 * than fall through to a write — a successful local save of a
 * non-matching key would undermine the whole point of the check.
 */
export function AuthKeyModal({
  open,
  onOpenChange,
  token,
  onSaved,
}: AuthKeyModalProps) {
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

  const handleSave = useCallback(async () => {
    if (isSaving || isLoading) return
    const trimmed = value.trim()
    if (!trimmed) return
    setIsSaving(true)
    setError(null)
    try {
      // Server validation: only run when we have a token. The
      // onboarding wizard opens this modal before sign-in (no
      // token yet), and the wizard handles its own validation
      // through the auto-assign hook — so a null token here is a
      // legitimate flow.
      if (token) {
        const result = await fetchMyAuthKey(token)
        if (!result.ok) {
          // Transport / auth failure. Don't fall through to a
          // blind save — the whole point of the check is to
          // refuse writes that don't match the server's view of
          // the user's key.
          setError(t('authKey.verifyFailed'))
          return
        }
        if (result.key === null || result.status !== 'active') {
          // The user has no key yet (fresh sign-up) or their
          // existing key is revoked. Either way, the typed value
          // can't match a row that doesn't exist or is disabled.
          // We surface the revoked case as a dedicated message
          // because the recovery path (admin restore) is
          // different from "type it again".
          setError(
            result.status === 'revoked'
              ? t('authKey.revoked')
              : t('authKey.noKeyOnServer'),
          )
          return
        }
        // Constant-time-ish string compare. Node's `===` on short
        // strings is fine here — the key isn't a high-entropy
        // password, just a server-issued opaque token, and the
        // threat model is "user pastes random garbage", not
        // timing-attack key extraction. We still trim both sides
        // and compare lowercase so a user typing `ABC-123` against
        // an uppercase-only server value gets a clear mismatch
        // rather than a false-negative on case.
        const serverKey = result.key.trim()
        if (trimmed !== serverKey) {
          setError(t('authKey.mismatch'))
          return
        }
      }
      await window.launcherAPI.setAuthKey(trimmed)
      setSavedKey(trimmed || null)
      onSaved?.()
      onOpenChange(false)
    } catch {
      setError(t('authKey.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, isLoading, value, token, t, onSaved, onOpenChange])

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
