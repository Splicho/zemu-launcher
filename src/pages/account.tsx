import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Eye, EyeOff, KeyRound, PencilLine } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { AuthKeyModal } from '@/components/auth-key-modal'

/**
 * Account page — entry point reachable from the avatar dropdown
 * (`Account → #/account`). Currently exposes one panel: the user's
 * saved auth key, with reveal and copy affordances, plus a "Change"
 * shortcut into the existing `AuthKeyModal` for editing/clearing.
 *
 * The key is fetched lazily on mount via `launcherAPI.getAuthKey()`
 * and shown masked by default (`••••••••`). Toggling reveal swaps
 * between the masked placeholder and the raw key in a `font-mono`
 * span. The copy button writes the raw key to the clipboard via
 * `navigator.clipboard.writeText` and surfaces a `toast` so the user
 * knows it succeeded — silently succeeding is bad UX because the
 * button has no other state to confirm the action.
 *
 * The masking helper intentionally mirrors the one in
 * `AuthKeyModal` (first 4 / last 4) so a key the user has already
 * seen once is recognizable in either surface.
 */
export function AccountPage() {
  const { t } = useTranslation()
  const [authKey, setAuthKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    if (!window.launcherAPI) {
      setLoadError(t('account.errors.unavailable'))
      setIsLoading(false)
      return
    }
    void window.launcherAPI
      .getAuthKey()
      .then((key) => {
        if (!cancelled) setAuthKey(key ?? null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const handleCopy = useCallback(async () => {
    if (!authKey) return
    try {
      await navigator.clipboard.writeText(authKey)
      toast.success(t('account.copied'))
    } catch (error) {
      toast.error(t('common.error'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [authKey, t])

  const handleSaved = useCallback(() => {
    // Refresh the displayed key from disk so the reveal panel
    // reflects the new value the user just typed.
    void window.launcherAPI?.getAuthKey().then((key) => {
      setAuthKey(key ?? null)
    })
  }, [])

  const hasKey = authKey !== null && authKey.length > 0

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">{t('account.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('account.description')}
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t('account.keyLabel')}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('account.keyDescription')}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setIsRevealed((prev) => !prev)
                }}
                disabled={!hasKey}
                aria-label={
                  isRevealed ? t('account.hideKey') : t('account.revealKey')
                }
                title={isRevealed ? t('account.hideKey') : t('account.revealKey')}
              >
                {isRevealed ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void handleCopy()
                }}
                disabled={!hasKey}
                aria-label={t('account.copyKey')}
                title={t('account.copyKey')}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>

          <Separator className="my-4" />

          {isLoading ? (
            <Skeleton className="h-5 w-64" />
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : hasKey ? (
            <p
              className="break-all font-mono text-sm tracking-wide"
              // `select-all` on click lets the user fall back to
              // manual selection if clipboard write is blocked by
              // browser permissions.
              onClick={(event) => {
                const target = event.currentTarget
                const range = document.createRange()
                range.selectNodeContents(target)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
              }}
            >
              {isRevealed ? authKey : maskKey(authKey)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('account.noKey')}
            </p>
          )}

          <Separator className="my-4" />

          <Button
            type="button"
            variant="gradient"
            onClick={() => setIsChangeModalOpen(true)}
          >
            <PencilLine className="size-4" />
            {hasKey ? t('account.changeKey') : t('account.addKey')}
          </Button>
        </div>
      </section>

      <AuthKeyModal
        open={isChangeModalOpen}
        onOpenChange={setIsChangeModalOpen}
        onSaved={handleSaved}
      />
    </div>
  )
}

/**
 * Show first 4 and last 4 chars of the key, masking the middle.
 * Mirrors `AuthKeyModal.maskKey` so users recognize the same shape
 * in either surface.
 */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}
