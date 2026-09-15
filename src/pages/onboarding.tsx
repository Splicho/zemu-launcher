import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, CheckCircle2, Download, Folder, HelpCircle, LogOut, RotateCw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthKeyHelpModal } from '@/components/auth-key-help-modal'
import { SteamInstructionsModal } from '@/components/steam-instructions-modal'
import { QrSteamGate, type QrGateState } from '@/components/qr-steam-gate'
import { TitleBar } from '@/components/title-bar'
import { markSteamInstructionsSeen } from '@/lib/steam-instructions'

/**
 * Discord server invite URL. Mirrors the value used by the in-app
 * sidebar link — keep both in sync if the server ever moves.
 */
const DISCORD_INVITE_URL = 'https://discord.gg/h1z1kotk'
import { markOnboardingCompleted } from '@/lib/onboarding'
import type { SetupChecks } from '@/lib/setup-checks'
import type { DepotProgress } from '@/lib/tauri-bridge'

/**
 * Four-step first-run wizard.
 *
 *   Step 1 — save the auth key (mandatory)
 *   Step 2 — pick an install folder
 *   Step 3 — get the base game (SteamCMD auto-download or manual)
 *   Step 4 — confirm and finish
 *
 * Layout follows the same pattern as the threadlab onboarding:
 *   - Top-left logo
 *   - Two-pane flex split (50/50 on sm+, stacked on mobile)
 *   - Left pane: form contents, no surrounding card
 *   - Right pane: hidden on mobile, slides in from the right and
 *     contains a preview rectangle with onboarding.jpg as hero art
 *   - 1px rounded stepper bars above the heading
 *
 * The wizard owns the full screen — no `<MainLayout>`, no sidebar.
 * AuthedApp renders this in place of `<MainLayout>` when the hash is
 * `#/onboarding`.
 *
 * On Finish we set `zemu-launcher.onboarding-completed = '1'` and
 * navigate to `#/`. Returning users with on-disk installs skip
 * straight to `/` via the gate hook (no manual rerun needed).
 */

type Step = 1 | 2 | 3 | 4

interface OnboardingPageProps {
  initialChecks: SetupChecks
  /**
   * Called by the parent when the user finishes the wizard. The
   * parent uses this to flip the hash to `#/`. It's been around since
   * Step 1 and the original implementation relied on it alone; see
   * `onRefreshGate` for the new wiring that fixes the
   * finish → redirect-back-into-wizard loop.
   */
  onFinish?: () => void
  /**
   * Re-evaluate the onboarding gate before the hash flip so the
   * redirect effect in `AuthedApp` sees `complete` and stops pulling
   * the user back into the wizard. The previous bug was that the
   * gate only ran once on mount (empty deps), so the `Finish`
   * callback's localStorage write didn't propagate in time — the
   * stale `incomplete` result pushed the route back to `#/onboarding`.
   */
  onRefreshGate?: () => Promise<void>
}

export function OnboardingPage({ initialChecks, onFinish, onRefreshGate }: OnboardingPageProps) {
  const { t } = useTranslation()
  const totalSteps = 4

  const [step, setStep] = useState<Step>(() => {
    // Skip steps whose inputs are already satisfied by the on-disk
    // setup checks. Step 1 is mandatory per the locked decision — even
    // with a saved key the user must re-confirm before we treat
    // onboarding as complete.
    if (initialChecks.hasFolder && initialChecks.hasBaseGame) return 4
    if (initialChecks.hasFolder) return 3
    return 1
  })

  const [authKey, setAuthKey] = useState('')
  // Synchronously seed `folder` from `initialChecks.folderPath` so the
  // "Choose folder" / "Change folder" button label is correct on first
  // paint. Without this, returning users see a brief "Choose folder"
  // flash on every launcher restart while the async `getDirectory()`
  // IPC round-trip below resolves. The effect below is kept as a
  // safety net in case the path read in `getSetupChecks` returned an
  // empty string despite `hasFolder=true` (storage drift).
  const [folder, setFolder] = useState<string | null>(
    initialChecks.folderPath ?? null,
  )
  const [hasMarker, setHasMarker] = useState(initialChecks.hasMarker)
  const [hasBaseGame, setHasBaseGame] = useState(initialChecks.hasBaseGame)

  // Safety net: if `initialChecks.folderPath` came back null despite
  // `hasFolder=true` (storage drift / partial write — the gate treats
  // empty strings as "not set" so the path is dropped), re-read via
  // `getDirectory()` and fall back to the `__existing__` sentinel so
  // the user is forced to re-pick in Step 2. With the new
  // synchronous hydration above this should almost never fire; keep
  // it so we degrade gracefully if it ever does.
  useEffect(() => {
    if (!initialChecks.hasFolder || folder) return
    let cancelled = false
    Promise.resolve()
      .then(() => window.gameAPI?.getDirectory?.())
      .then((path) => {
        if (cancelled) return
        if (typeof path === 'string' && path.trim().length > 0) {
          setFolder(path)
        } else {
          setFolder('__existing__')
        }
      })
      .catch(() => {
        if (cancelled) return
        setFolder('__existing__')
      })
    return () => {
      cancelled = true
    }
  }, [initialChecks.hasFolder, folder])

  const advance = useCallback(() => {
    setStep((s) => (s < totalSteps ? ((s + 1) as Step) : s))
  }, [])
  const back = useCallback(() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s)), [])

  const finish = useCallback(() => {
    markOnboardingCompleted()
    // Re-run the gate *before* the hash flip. Without this, the
    // redirect effect in `AuthedApp` sees the stale `incomplete`
    // state it captured at mount and pushes the user straight back
    // into `#/onboarding`. Once `onRefreshGate()` resolves the gate
    // will publish `{ kind: 'complete' }` and the redirect effect's
    // next run is a no-op.
    void onRefreshGate?.().then(() => {
      onFinish?.()
      if (typeof window !== 'undefined') {
        window.location.hash = '#/'
      }
    })
  }, [onFinish, onRefreshGate])

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-muted bg-background text-foreground">
      {/* Shared window chrome — provides the OS drag region and the
          Minimize / Maximize / Close controls on the right. The
          onboarding steps render into the body below it. */}
      <TitleBar />

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1">
        {/* Left pane — form contents, no surrounding card. */}
        <div className="flex w-full flex-col overflow-y-auto p-6 sm:w-1/2 sm:p-10">
          <div className="my-auto w-full max-w-lg self-center">
            <Stepper current={step} total={totalSteps} />

            <div className="mb-8 mt-6">
              <h1 className="text-3xl font-semibold tracking-tight">
                {t(`onboarding.step${step}.title`)}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(`onboarding.step${step}.description`)}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.div
                  key="step-1"
                  initial={{ y: 40, opacity: 0, filter: 'blur(8px)' }}
                  animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ y: -20, opacity: 0, filter: 'blur(8px)' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <AccessKeyStep
                    authKey={authKey}
                    setAuthKey={setAuthKey}
                    onContinue={advance}
                    t={t}
                  />
                </motion.div>
              ) : null}

              {step === 2 ? (
                <motion.div
                  key="step-2"
                  initial={{ y: 40, opacity: 0, filter: 'blur(8px)' }}
                  animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ y: -20, opacity: 0, filter: 'blur(8px)' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <InstallFolderStep
                    folder={folder}
                    setFolder={(f) => {
                      setFolder(f)
                      setHasMarker(false)
                      setHasBaseGame(false)
                    }}
                    onBack={back}
                    onContinue={advance}
                    t={t}
                  />
                </motion.div>
              ) : null}

              {step === 3 ? (
                <motion.div
                  key="step-3"
                  initial={{ y: 40, opacity: 0, filter: 'blur(8px)' }}
                  animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ y: -20, opacity: 0, filter: 'blur(8px)' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <BaseGameStep
                    folder={folder}
                    onBack={back}
                    onContinue={() => {
                      setHasBaseGame(true)
                      setHasMarker(true)
                      advance()
                    }}
                    onSkip={() => {
                      setHasBaseGame(true)
                      setHasMarker(false)
                      advance()
                    }}
                    t={t}
                  />
                </motion.div>
              ) : null}

              {step === 4 ? (
                <motion.div
                  key="step-4"
                  initial={{ y: 40, opacity: 0, filter: 'blur(8px)' }}
                  animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ y: -20, opacity: 0, filter: 'blur(8px)' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <FinishStep
                    hasKey={!!authKey.trim() || initialChecks.hasKey}
                    hasFolder={!!folder && folder !== '__existing__' ? true : !!folder}
                    hasBaseGame={hasBaseGame}
                    hasMarker={hasMarker}
                    onFinish={finish}
                    t={t}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* Right pane — onboarding.jpg fills the full width/height
            of the pane, hidden on mobile. Static on first mount; the
            no-animation request is intentional (the hero art should
            just be present, not animated in). */}
        <div className="relative hidden items-center justify-center overflow-hidden border-l border-border bg-background sm:flex sm:w-1/2">
          <img
            src="/background/onboarding.jpg"
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      </div>
    </div>
    </TooltipProvider>
  )
}

interface StepperProps {
  current: number
  total: number
}

/**
 * Threadlab-style stepper: a row of 1px tall rounded-full flex-1 bars.
 * Steps at or below the current index render as `bg-primary`, others
 * as `bg-muted`.
 */
function Stepper({ current, total }: StepperProps) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={[
            'h-1 flex-1 rounded-full transition-colors',
            i < current ? 'bg-primary' : 'bg-muted',
          ].join(' ')}
        />
      ))}
    </div>
  )
}

interface AccessKeyStepProps {
  authKey: string
  setAuthKey: (v: string) => void
  onContinue: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}

function AccessKeyStep({ authKey, setAuthKey, onContinue, t }: AccessKeyStepProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    void window.launcherAPI?.getAuthKey?.().then((key) => {
      if (cancelled) return
      setAuthKey(key ?? '')
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [setAuthKey])

  const handleSave = async () => {
    if (isSaving || !authKey.trim()) return
    setIsSaving(true)
    setError(null)
    try {
      await window.launcherAPI?.setAuthKey?.(authKey.trim())
      onContinue()
    } catch {
      setError(t('authKey.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="onboarding-auth-key">{t('authKey.inputLabel')}</Label>
          <Input
            id="onboarding-auth-key"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t('authKey.placeholder')}
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && authKey.trim()) void handleSave()
            }}
            disabled={isSaving || isLoading}
            className="font-mono"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label={t('onboarding.step1.howTo.triggerAria')}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          <HelpCircle className="size-3.5" />
          {t('onboarding.step1.howTo.trigger')}
        </button>
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          variant="gradient"
          onClick={() => void handleSave()}
          disabled={!authKey.trim() || isSaving || isLoading}
        >
          {t('onboarding.step1.continue')}
        </Button>
      </div>

      <AuthKeyHelpModal
        open={helpOpen}
        onOpenChange={setHelpOpen}
        discordInviteUrl={DISCORD_INVITE_URL}
      />
    </div>
  )
}

interface InstallFolderStepProps {
  folder: string | null
  setFolder: (path: string | null) => void
  onBack: () => void
  onContinue: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}

function InstallFolderStep({ folder, setFolder, onBack, onContinue, t }: InstallFolderStepProps) {
  const [isPicking, setIsPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePick = async () => {
    if (isPicking) return
    setIsPicking(true)
    setError(null)
    try {
      const picked = await window.gameAPI?.selectDirectory?.()
      if (typeof picked === 'string' && picked.length > 0) {
        setFolder(picked)
      }
    } catch {
      setError(t('toasts.failedToSelectDirectory'))
    } finally {
      setIsPicking(false)
    }
  }

  return (
    <div>
      <div className="space-y-4">
        <Button
          variant="outline"
          onClick={() => void handlePick()}
          disabled={isPicking}
          className="w-full h-12 text-base gap-2.5"
        >
          {isPicking ? <Spinner className="size-5" /> : <Folder className="size-5" />}
          {folder ? t('onboarding.step2.change') : t('onboarding.step2.choose')}
        </Button>
        {folder && folder !== '__existing__' ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground break-all font-mono">
            {t('onboarding.step2.pathChosen')} {folder}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button
          variant="gradient"
          onClick={onContinue}
          disabled={!folder || folder === '__existing__'}
        >
          {t('onboarding.step2.continue')}
        </Button>
      </div>
    </div>
  )
}

interface BaseGameStepProps {
  folder: string | null
  onBack: () => void
  /** Auto-download succeeded — we have a Zemu-managed base game. */
  onContinue: () => void
  /** User chose manual and acknowledged the Steam instructions modal. */
  onSkip: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}

function BaseGameStep({ folder, onBack, onContinue, onSkip, t }: BaseGameStepProps) {
  // Whether the pure-Rust orchestrator is reachable. (Always true
  // on this build; kept as a state probe for parity with the
  // historical Node-bridge availability check.)
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null)

  // True once `loginStatus` returns `authed: true`. Kept separate
  // from `pipelineState` so we can render the "Signed in as X"
  // card with a "Start download" CTA without also advancing the
  // pipeline lifecycle — those are independent concerns.
  const [alreadyAuthed, setAlreadyAuthed] = useState(false)

  // True once the user has intentionally triggered the Steam auth flow
  // (either via QR scan or the "download without QR" shortcut). Until
  // this is set, we treat a pre-existing `authed: true` from
  // `loginStatus` as "not our doing" and fall through to the QR gate
  // instead of the "Signed in as X" card — so a fresh install never
  // shows that card out of the box.
  const [authInitiated, setAuthInitiated] = useState(false)

  // Initial Steam auth probe — if a token is already in the keychain
  // we skip the QR entirely and let the user click "Start download"
  // right away. The single `pipelineState` machine encodes both the
  // QR lifecycle and the download lifecycle, so we don't keep a
  // separate `authed` boolean.
  const [accountName, setAccountName] = useState<string | null>(null)

  // Combined QR + download lifecycle. The scan-and-go pipeline
  // runs both phases on the same orchestrator; we mirror every
  // event into local state for the wizard to render.
  //
  //   idle                 — never started, or user dismissed a previous attempt
  //   connecting           — pipeline spawned, waiting for the QR URL
  //   awaiting_scan        — QR displayed, player hasn't scanned yet
  //   awaiting_confirm     — player scanned, waiting for phone approval
  //   downloading          — authed, downloading depot
  //   done                 — download finished; wizard advances
  //   failed               — pipeline errored; `errorMessage` carries the reason
  const [pipelineState, setPipelineState] = useState<QrGateState>('idle')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  // Depot download progress. Populated by `depot-progress` events
  // from the same pipeline.
  const [depotProgress, setDepotProgress] = useState<DepotProgress | null>(null)
  const [showSteamModal, setShowSteamModal] = useState(false)

  // Probe bridge availability + initial auth status on mount.
  useEffect(() => {
    let cancelled = false
    void window.steamApi?.isAvailable?.().then((value) => {
      if (!cancelled) setBridgeAvailable(value === true)
    })
    void window.steamApi?.loginStatus?.().then((status) => {
      if (cancelled) return
      setAccountName(status.accountName ?? null)
      // Pre-existing token → leave the gate in `'idle'` and let the
      // parent render the authed-but-not-yet-downloading action
      // card. Flipping `pipelineState` to `'done'` here was the bug
      // that made the body collapse to just heading + Back +
      // Manual-open for returning users: `QrSteamGate` skipped
      // itself (`qrGateState !== 'done'`), the floating body button
      // never rendered (its condition `qrGateState === 'done' &&
      // isIdle` is logically impossible — `'done'` and `'idle'` are
      // mutually exclusive), and the bottom-bar CTA also dropped
      // into the manual-open outline branch.
      //
      // We mark the auth flow as "initiated" *only* when the saved
      // token belongs to the user who is currently sitting in the
      // wizard — i.e. it was present on Step 3 mount. That way a
      // fresh install that happens to have a stale keychain entry
      // (which previously caused the green "Signed in as X" card
      // to flash before the user clicked anything) falls through
      // to the QR gate. Returning users with their own real token
      // still see the card immediately.
      if (status.authed) {
        setAlreadyAuthed(true)
        setAuthInitiated(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Pipeline-event subscriptions. Active whenever the pipeline is
  // running — covers both QR events and download events because
  // they're emitted by the same orchestrator on the same runtime.
  useEffect(() => {
    if (pipelineState === 'idle' || pipelineState === 'done') return
    const offs: Array<() => void> = []
    const offQr = window.steamApi?.onQr?.((dataUrl) => {
      setQrDataUrl(dataUrl)
      setPipelineState('awaiting_scan')
    })
    const offScanned = window.steamApi?.onScanned?.(() => {
      setPipelineState('awaiting_confirm')
    })
    const offAuthed = window.steamApi?.onAuthed?.((name) => {
      setAccountName(name)
      // Drop the QR immediately so the wizard UI transitions to the
      // progress bar without flashing a stale "scan me" image.
      setQrDataUrl(null)
    })
    const offLoginError = window.steamApi?.onLoginError?.((message) => {
      setPipelineError(message)
      setPipelineState('failed')
    })
    const offProgress = window.steamApi?.onDepotProgress?.((p) => {
      setDepotProgress(p)
      // First progress event marks the auth → download transition.
      if (pipelineState !== 'downloading') {
        setPipelineState('downloading')
      }
    })
    const offDone = window.steamApi?.onDepotDone?.(() => {
      setPipelineState('done')
      setDepotProgress(null)
      onContinue()
    })
    const offDepotError = window.steamApi?.onDepotError?.((message) => {
      setPipelineError(message)
      setPipelineState('failed')
    })
    if (offQr) offs.push(offQr)
    if (offScanned) offs.push(offScanned)
    if (offAuthed) offs.push(offAuthed)
    if (offLoginError) offs.push(offLoginError)
    if (offProgress) offs.push(offProgress)
    if (offDone) offs.push(offDone)
    if (offDepotError) offs.push(offDepotError)
    return () => {
      offs.forEach((off) => off())
    }
    // We intentionally read `pipelineState` once at subscribe-time;
    // the cleanup tears everything down on unmount or state flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineState === 'idle' || pipelineState === 'done', onContinue])

  const beginScanAndGo = useCallback(async () => {
    if (!folder || folder === '__existing__' || !window.steamApi) return
    setPipelineState('connecting')
    setPipelineError(null)
    setQrDataUrl(null)
    setDepotProgress(null)
    setAuthInitiated(true)
    try {
      await window.steamApi.startInstallPipeline(folder)
    } catch (e) {
      setPipelineError(e instanceof Error ? e.message : String(e))
      setPipelineState('failed')
    }
  }, [folder])

  const cancelPipeline = useCallback(async () => {
    try {
      await window.steamApi?.loginCancel?.()
    } catch {
      /* orchestrator may have already exited */
    }
    setPipelineState('idle')
    setQrDataUrl(null)
    setDepotProgress(null)
  }, [])

  const retryPipeline = useCallback(() => {
    setPipelineError(null)
    setQrDataUrl(null)
    setDepotProgress(null)
    void beginScanAndGo()
  }, [beginScanAndGo])

  const signOut = useCallback(async () => {
    try {
      await window.steamApi?.logout?.()
    } catch {
      /* best effort */
    }
    setAccountName(null)
    setPipelineState('idle')
    setQrDataUrl(null)
    setPipelineError(null)
    setDepotProgress(null)
    setAlreadyAuthed(false)
    setAuthInitiated(false)
  }, [])

  // When a returning user is already authed, drop them straight into
  // the download-only path (no QR scan needed).
  const startDownloadOnly = useCallback(async () => {
    if (!folder || folder === '__existing__' || !window.steamApi) return
    setPipelineState('downloading')
    setPipelineError(null)
    setDepotProgress(null)
    setAuthInitiated(true)
    try {
      await window.steamApi.installDepot(folder)
      setPipelineState('done')
      onContinue()
    } catch (e) {
      setPipelineError(e instanceof Error ? e.message : String(e))
      setPipelineState('failed')
    }
  }, [folder, onContinue])

  const handleManualAcknowledge = useCallback(async () => {
    markSteamInstructionsSeen()
    setShowSteamModal(false)
    onSkip()
  }, [onSkip])

  // While the orchestrator is unreachable (e.g. dev build with a
  // stripped feature), fall through to the manual instructions modal.
  if (bridgeAvailable === false) {
    return (
      <div>
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t('onboarding.step3.qrGate.bridgeMissing')}
        </div>
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
          <Button
            variant="gradient"
            onClick={() => setShowSteamModal(true)}
          >
            {t('onboarding.step3.manual.open')}
          </Button>
        </div>
        <SteamInstructionsModal
          open={showSteamModal}
          onOpenChange={setShowSteamModal}
          onAcknowledge={handleManualAcknowledge}
        />
      </div>
    )
  }

  // Convenience flags. Plain equality only — no derived state that
  // could collide with itself across renders.
  const isDownloading = pipelineState === 'downloading'
  const isFailed = pipelineState === 'failed'
  const isIdle = pipelineState === 'idle'

  // Three mutually-exclusive body states. Used as a single switch
  // so the JSX tree is impossible to render-empty by accident.
  //
  //   1. `authedIdle`  — saved token, user hasn't clicked Start.
  //                     Show the green "Signed in as X" card and
  //                     a Start-download CTA in the bottom bar.
  //   2. `downloading` — pipeline in flight. Show progress card.
  //   3. `qr`          — anything else (idle, connecting, scan,
  //                     confirm, failed). Show `QrSteamGate`; it
  //                     owns its own UI for failed/connecting/etc.

  const authedIdle =
    authInitiated &&
    alreadyAuthed &&
    pipelineState === 'idle' &&
    !isDownloading &&
    !isFailed
  const showQrGate = !authedIdle && !isDownloading
  const showProgress = isDownloading

  return (
    <div className="flex flex-col gap-4">
      {authedIdle ? (
        <div className="flex flex-col items-center gap-4 rounded-md border border-green-500/30 bg-green-500/5 p-6 text-center">
          <CheckCircle2 className="size-12 text-green-500" />
          <div className="space-y-1">
            <p className="text-base font-medium text-green-500">
              {t('onboarding.step3.qrGate.authed', {
                account: accountName ?? '',
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.step3.qrGate.authedHint')}
            </p>
          </div>
          <Button
            variant="gradient"
            className="w-full"
            onClick={() => void startDownloadOnly()}
            disabled={!folder || folder === '__existing__'}
          >
            <Download className="size-4" />
            {t('onboarding.step3.auto.start')}
          </Button>
        </div>
      ) : null}

      {showQrGate ? (
        <QrSteamGate
          state={pipelineState}
          dataUrl={qrDataUrl}
          accountName={accountName}
          errorMessage={pipelineError}
          onBegin={beginScanAndGo}
          onCancel={cancelPipeline}
          onRetry={retryPipeline}
          onSignOut={signOut}
        />
      ) : null}

      {showProgress ? (
        <div className="min-h-[120px]">
          <div className="space-y-3 rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Spinner className="size-4" />
                {t('onboarding.step3.auto.running')}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {depotProgress &&
                typeof depotProgress.bytesTotal === 'number' &&
                depotProgress.bytesTotal > 0
                  ? `${Math.round(((depotProgress.bytesDone ?? 0) / depotProgress.bytesTotal) * 100)}%`
                  : '0%'}
              </span>
            </div>
            <Progress
              value={
                depotProgress &&
                typeof depotProgress.bytesTotal === 'number' &&
                depotProgress.bytesTotal > 0
                  ? Math.round(
                      ((depotProgress.bytesDone ?? 0) / depotProgress.bytesTotal) * 100,
                    )
                  : 0
              }
            />
            <div className="flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void cancelPipeline()}
              >
                <X className="size-4" />
                {t('onboarding.step3.cancel')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isFailed ? (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">{t('onboarding.step3.errorTitle')}</p>
          <p>{pipelineError}</p>
          <div className="flex justify-end gap-2 pt-2">
            {pipelineError && !pipelineError.toLowerCase().includes('bridge missing') ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
                {t('onboarding.step3.qrGate.signOut')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={retryPipeline}>
              <RotateCw className="size-4" />
              {t('common.retry')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={isDownloading}>
          {t('common.back')}
        </Button>
        <div className="flex gap-2">
          {authedIdle ? (
            <Button
              variant="outline"
              onClick={() => setShowSteamModal(true)}
              disabled={false}
            >
              {t('onboarding.step3.manual.open')}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowSteamModal(true)}
              disabled={!isIdle && !isFailed}
            >
              {t('onboarding.step3.manual.open')}
            </Button>
          )}
        </div>
      </div>

      <SteamInstructionsModal
        open={showSteamModal}
        onOpenChange={setShowSteamModal}
        onAcknowledge={handleManualAcknowledge}
      />
    </div>
  )
}

interface FinishStepProps {
  hasKey: boolean
  hasFolder: boolean
  hasBaseGame: boolean
  hasMarker: boolean
  onFinish: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}

function FinishStep({ hasKey, hasFolder, hasBaseGame, hasMarker, onFinish, t }: FinishStepProps) {
  // The patch line is always true on this build — the patcher's
  // `update.rs` runs the moment the user clicks Play and the game
  // folder exists. We render it as informational, not a gate.
  const items = [
    { ok: hasKey, label: t('onboarding.step4.checklist.key') },
    { ok: hasFolder, label: t('onboarding.step4.checklist.folder') },
    {
      ok: hasBaseGame,
      label: hasMarker
        ? t('onboarding.step4.checklist.baseGame')
        : `${t('onboarding.step4.checklist.baseGame')} (manual)`,
    },
    { ok: true, label: t('onboarding.step4.checklist.patch') },
  ]

  const allOk = items.every((i) => i.ok)

  return (
    <div>
      <ul className="space-y-3">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
          >
            <span
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full',
                item.ok
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-destructive/15 text-destructive',
              ].join(' ')}
            >
              {item.ok ? <Check className="size-4" /> : <X className="size-4" />}
            </span>
            <span className="text-sm">{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex justify-end">
        <Button variant="gradient" onClick={onFinish} disabled={!allOk}>
          {t('onboarding.step4.finish')}
        </Button>
      </div>
    </div>
  )
}