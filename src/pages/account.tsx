import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound, PencilLine } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { AuthKeyModal } from '@/components/auth-key-modal'
import { fetchMyAuthKey } from '@/lib/auth'
import { useAuthContext } from '@/contexts/auth-context'
import { LAUNCHER_CONFIG } from '@/config/launcher'

/**
 * Account page — entry point reachable from the avatar dropdown
 * (`Account → #/account`). Exposes one panel: the user's auth key,
 * with reveal and copy affordances, plus a "Change" shortcut into
 * the existing `AuthKeyModal` for editing/clearing.
 *
 * Hydration order on mount:
 *
 *   1. Read the on-disk key (`launcherAPI.getAuthKey()`). A user
 *      who already has a saved key sees it instantly without
 *      waiting on the network.
 *   2. If signed in, also ask the auth app for the canonical key
 *      (`fetchMyAuthKey`). When the server returns an active key
 *      and it differs from disk, we re-save it — this covers the
 *      case where the user previously pasted a stale key, or where
 *      an admin re-minted their key upstream.
 *   3. If the server says the key is `revoked`, we deliberately
 *      blank the on-disk value and surface a banner pointing the
 *      user at the website account settings page so they can
 *      request a restore. Persisting a revoked key locally would
 *      let the user launch the game with a key the admin has
 *      explicitly disabled upstream.
 *   4. Transport failures (`unreachable`, `expired_token`, …) show
 *      a soft note and leave whatever disk value is in place.
 *
 * The key is shown masked by default (`••••••••`). Toggling reveal
 * swaps between the masked placeholder and the raw key in a
 * `font-mono` span. The copy button writes the raw key to the
 * clipboard via `navigator.clipboard.writeText` and surfaces a
 * `toast` so the user knows it succeeded — silently succeeding is
 * bad UX because the button has no other state to confirm the
 * action.
 *
 * The masking helper intentionally mirrors the one in
 * `AuthKeyModal` (first 4 / last 4) so a key the user has already
 * seen once is recognizable in either surface.
 */
/**
 * `banner` variants the key panel can render above the key. Same
 * shape as the onboarding Step 1 banner so the JSX stays flat:
 * `revoked` shows the destructive-style alert, `fetch-failed`
 * shows the muted "we tried, here's why" line, `null` means
 * there's nothing to surface (either we haven't tried yet, the
 * fetch succeeded and we're showing the key, or the fetch
 * returned `key === null` and the panel already says "no key set").
 */
type AccountBanner =
  | { kind: 'revoked' }
  | { kind: 'fetch-failed'; reason: string }
  | null

export function AccountPage() {
  const { t } = useTranslation()
  const { token } = useAuthContext()
  const [authKey, setAuthKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false)
  const [banner, setBanner] = useState<AccountBanner>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    setBanner(null)
    if (!window.launcherAPI) {
      setLoadError(t('account.errors.unavailable'))
      setIsLoading(false)
      return
    }

    async function hydrate() {
      // 1. Disk first — same as before, so a returning user with a
      //    locally-saved key sees it instantly without waiting on
      //    the network round-trip.
      let onDisk: string | null = null
      try {
        onDisk = (await window.launcherAPI?.getAuthKey?.()) ?? null
      } catch (error: unknown) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : String(error),
          )
        }
      }
      if (cancelled) return
      const existing = typeof onDisk === 'string' ? onDisk : null
      if (existing && existing.length > 0) {
        setAuthKey(existing)
      }

      // 2. If signed in, ask the server for the canonical key.
      //    This is the path that lets the user see the *right*
      //    key without ever having to type it. We don't block on
      //    this — disk value (if any) is already shown — so a slow
      //    network doesn't leave the page blank.
      if (token?.token) {
        const result = await fetchMyAuthKey(token.token)
        if (cancelled) return

        if (result.ok && result.key && result.status === 'active') {
          // Save server value to disk if it differs — covers the
          // case where the user previously pasted a key that's now
          // been re-minted upstream. Writing the same value is
          // cheap and idempotent, so we don't bother diffing.
          if (result.key !== existing) {
            try {
              await window.launcherAPI?.setAuthKey?.(result.key)
            } catch {
              // Disk write failed but we still show the key — the
              // user can copy it. Persisting on next visit will
              // retry naturally.
            }
          }
          setAuthKey(result.key)
          setBanner(null)
        } else if (result.ok && result.status === 'revoked') {
          // Refuse to persist a revoked key locally. If we already
          // had a key on disk from a previous session, blank it so
          // the play page stops trusting it — otherwise the user
          // could launch the game with a key the admin explicitly
          // disabled.
          if (existing && existing.length > 0) {
            try {
              await window.launcherAPI?.setAuthKey?.('')
            } catch {
              // best-effort
            }
          }
          setAuthKey(null)
          setBanner({ kind: 'revoked' })
        } else if (!result.ok) {
          // Network blip / server unreachable. Disk value (if any)
          // stays on screen; surface a soft note explaining why
          // we're not updating it from the server.
          setBanner({ kind: 'fetch-failed', reason: result.reason })
        }
        // `key === null && status === null` is the "no key on
        // server" case — nothing to do, the panel already shows
        // "no key set" via the `hasKey` check.
      }

      if (!cancelled) setIsLoading(false)
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [t, token?.token])

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

  const hasKey = authKey !== null && authKey.length > 0

  // Stable primitive so React Compiler and the manual dep array
  // agree on a single value to compare. Pulled out of `token`
  // because `useCallback([token?.token])` and the compiler's inferred
  // `[token]` deps don't match (compiler sees the object ref, manual
  // deps see the inner string) and that mismatch trips
  // `react-hooks/preserve-manual-memoization`.
  const bearerToken = token?.token ?? null

  const handleSaved = useCallback(() => {
    // Refresh the displayed key from disk so the reveal panel
    // reflects the new value the user just typed.
    void window.launcherAPI?.getAuthKey().then((key) => {
      setAuthKey(key ?? null)
      // Re-fetch from the server so the panel reflects the
      // canonical value (the user might have pasted a typo, or
      // an admin might have revoked the key in the time since
      // we last polled). We do this best-effort — a network
      // failure here just leaves the panel showing whatever the
      // user typed, which is what they'd expect from a "Save"
      // button anyway.
      if (bearerToken) {
        void fetchMyAuthKey(bearerToken).then((result) => {
          if (!result.ok) {
            setBanner({ kind: 'fetch-failed', reason: result.reason })
            return
          }
          if (result.status === 'revoked') {
            setBanner({ kind: 'revoked' })
            return
          }
          setBanner(null)
          if (result.key && result.status === 'active') {
            setAuthKey(result.key)
          }
        })
      }
    })
  }, [bearerToken])

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
          {banner?.kind === 'revoked' ? (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                {t('account.revokedBanner')}{' '}
                <a
                  href={LAUNCHER_CONFIG.accountSettingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2 hover:text-destructive/80"
                >
                  {t('account.revokedBannerLink')}
                </a>
              </span>
            </div>
          ) : null}

          {banner?.kind === 'fetch-failed' ? (
            <p
              role="status"
              className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
            >
              {t('account.fetchFallback', { reason: banner.reason })}
            </p>
          ) : null}

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
        // Pass the bearer token so the modal can validate the
        // typed key against the canonical server value before
        // writing to disk. See the AuthKeyModal JSDoc for the
        // threat model + failure-posture rationale.
        token={token?.token ?? null}
        onSaved={handleSaved}
      />
    </div>
  )
}

/**
 * Fully redact the auth key with bullets. Same length as the raw
 * key so the surrounding layout (and any visible width constraint
 * around the key field) stays stable between masked and revealed
 * states — only the bullet glyphs swap for the real characters.
 *
 * The launcher only has ONE display surface where masking applies
 * — this account page. The `AuthKeyModal` is an *editing* surface
 * where the user types the key straight into an Input; masking
 * there would defeat the point (and break the validator). Keep
 * maskKey local to this file.
 */
function maskKey(key: string): string {
  return '•'.repeat(key.length)
}
