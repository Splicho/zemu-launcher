import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LogIn, Smartphone, X, AlertCircle, RotateCw, CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * High-level states for the QR + depot-download pipeline. The
 * wizard's CTA flips between them; we don't try to drive the Tauri
 * events themselves from here — the parent wires up listeners and
 * pushes state down.
 *
 * `idle`         — never started, or user dismissed a previous attempt.
 * `connecting`   — pipeline spawned, waiting for the QR URL.
 * `awaiting_scan` — QR displayed, player hasn't scanned yet.
 * `awaiting_confirm` — player scanned, waiting for phone approval.
 * `downloading`  — QR approved, depot download in flight (the
 *                   pipeline ran both phases back-to-back).
 * `done`         — download finished; wizard advances.
 * `failed`       — pipeline errored out; `errorMessage` carries the reason.
 */
export type QrGateState =
  | 'idle'
  | 'connecting'
  | 'awaiting_scan'
  | 'awaiting_confirm'
  | 'downloading'
  | 'done'
  | 'failed'

interface QrSteamGateProps {
  state: QrGateState
  /** Data URL of the QR image (only present in `awaiting_scan`). */
  dataUrl: string | null
  /** Public Steam account name once `state === 'done'`. */
  accountName: string | null
  /** Bridge error message when `state === 'failed'`. */
  errorMessage: string | null
  /** Begin the QR login (parent calls into `steamApi.loginBegin`). */
  onBegin: () => void
  /** Cancel an in-flight login (parent calls into `steamApi.loginCancel`). */
  onCancel: () => void
  /** Reset back to `idle` so the player can try again after a failure. */
  onRetry: () => void
  /** Forget the saved token and return to `idle`. */
  onSignOut: () => void
  /**
   * Continue past the gate once authenticated. Optional — when
   * omitted the gate renders a "Continue" button that triggers
   * this. Useful when the wizard owns the "next" CTA itself.
   */
  onContinue?: () => void
}

/**
 * QR-code Steam login gate.
 *
 * Mirrors the `steam-gate` UI from the reference
 * `C:\Users\stupi\Documents\Repos\ZEmu-Launcher-main` Electron
 * launcher, adapted to React + Tailwind. The Rust sidecar
 * (`steam-bridge.cjs`) does the heavy lifting; this component is a
 * pure renderer driven by props.
 *
 * The QR itself is a `<img>` showing the data URL the bridge ships
 * via the `steam-qr` Tauri event. Players scan it with the Steam
 * Mobile app, approve on their phone, and the bridge emits
 * `steam-authed` — we flip to `done` and the parent advances the
 * wizard.
 *
 * The QR is single-use and expires after 30s (Steam's default
 * `loginTimeout`). On expiry the bridge emits `steam-error` with
 * "login timed out"; the gate flips to `failed` and surfaces a
 * retry button.
 */
export function QrSteamGate({
  state,
  dataUrl,
  accountName,
  errorMessage,
  onBegin,
  onCancel,
  onRetry,
  onSignOut,
  onContinue,
}: QrSteamGateProps) {
  const { t } = useTranslation()

  // Cancel any in-flight login when the gate unmounts. Important
  // when the wizard navigates away mid-scan — leaving the bridge
  // child alive wastes Steam rate-limit budget.
  useEffect(() => {
    return () => {
      if (state === 'connecting' || state === 'awaiting_scan' || state === 'awaiting_confirm') {
        onCancel()
      }
    }
    // We intentionally exclude `state` and `onCancel` from deps —
    // the cleanup runs on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSignOut = useCallback(() => {
    onSignOut()
  }, [onSignOut])

  const statusMessage = (() => {
    switch (state) {
      case 'idle':
        return null
      case 'connecting':
        return t('onboarding.step3.qrGate.connecting')
      case 'awaiting_scan':
        return t('onboarding.step3.qrGate.scanHint')
      case 'awaiting_confirm':
        return t('onboarding.step3.qrGate.scanned')
      case 'done':
        return t('onboarding.step3.qrGate.authed', { account: accountName ?? '' })
      case 'failed':
        return (
          errorMessage ??
          t('onboarding.step3.qrGate.timeout')
        )
    }
  })()

  return (
    <div className="flex flex-col gap-4">
      {state === 'done' ? (
        <div className="flex flex-col items-center gap-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <CheckCircle2 className="size-12 text-emerald-500" />
          <div className="space-y-1">
            <p className="text-base font-medium text-emerald-500">
              {t('onboarding.step3.qrGate.authed', { account: accountName ?? '' })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.step3.qrGate.authedHint')}
            </p>
          </div>
          <div className="flex w-full justify-between gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              {t('onboarding.step3.qrGate.signOut')}
            </Button>
            {onContinue ? (
              <Button variant="gradient" size="sm" onClick={onContinue}>
                {t('onboarding.step3.continue')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {state !== 'done' ? (
        <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-card p-6">
          {state === 'idle' || state === 'failed' ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <LogIn className="size-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                {state === 'failed'
                  ? t('onboarding.step3.qrGate.failedTitle')
                  : t('onboarding.step3.qrGate.idleTitle')}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t('onboarding.step3.qrGate.idleDescription')}
              </p>
            </div>
          ) : null}

          {state === 'connecting' ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Spinner className="size-10" />
            </div>
          ) : null}

          {(state === 'awaiting_scan' || state === 'awaiting_confirm') && dataUrl ? (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg border border-border bg-background p-3">
                <img
                  src={dataUrl}
                  alt={t('onboarding.step3.qrGate.scanHint')}
                  className="size-56"
                  draggable={false}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {state === 'awaiting_confirm' ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                ) : (
                  <Smartphone className="size-3.5" />
                )}
                <span>{statusMessage}</span>
              </div>
            </div>
          ) : null}

          {state === 'failed' && errorMessage ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-words">{errorMessage}</span>
            </div>
          ) : null}

          <div className="flex w-full justify-between gap-2 pt-2">
            {state === 'idle' ? (
              <Button variant="gradient" className="w-full" onClick={onBegin}>
                <LogIn className="size-4" />
                {t('onboarding.step3.qrGate.button')}
              </Button>
            ) : null}

            {state === 'connecting' ||
            state === 'awaiting_scan' ||
            state === 'awaiting_confirm' ? (
              <>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  <X className="size-4" />
                  {t('common.cancel')}
                </Button>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3" />
                  {statusMessage}
                </span>
              </>
            ) : null}

            {state === 'failed' ? (
              <>
                <Button variant="outline" size="sm" onClick={onRetry}>
                  <RotateCw className="size-4" />
                  {t('onboarding.step3.qrGate.retry')}
                </Button>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="size-3" />
                  {t('onboarding.step3.qrGate.failedHint')}
                </span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
