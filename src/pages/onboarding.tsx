import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Check, CheckCircle2, Download, Folder, LogOut, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QrSteamGate, type QrGateState } from '@/components/qr-steam-gate'
import { TitleBar } from '@/components/title-bar'
import { fetchMyAuthKey } from '@/lib/auth'
import { markOnboardingCompleted } from '@/lib/onboarding'
import type { SetupChecks } from '@/lib/setup-checks'
import { getSetupChecks } from '@/lib/setup-checks'
import type { DepotProgress } from '@/lib/tauri-bridge'
import { useGameStateContext } from '@/hooks/use-game-state-context'
import { LAUNCHER_CONFIG } from '@/config/launcher'

/**
 * Three-step first-run wizard.
 *
 *   Step 1 — save the auth key (mandatory)
 *   Step 2 — pick an install folder
 *   Step 3 — get the base game via the SteamCMD auto-download (QR
 *            scan or pre-existing keychain token)
 *
 * The previous 4-step flow had a manual fallback at the bottom of
 * Step 3 that opened the Steam-instructions modal. That branch was
 * removed because the launcher no longer ships the Steam SDK on
 * every platform — every supported build can drive the QR flow
 * (or fall back to the failed/error state with a retry/back path).
 * Users who want the manual depot-command instructions can still
 * reach them via the sidebar's right-click "Install PS3 Manually"
 * entry or the read-only "Installation Guide" pane inside the
 * Properties dialog.
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
 * On Finish we set `LauncherConfig.onboarding_completed = true` on
 * the Rust side (see `src-tauri/src/storage.rs::mark_onboarding_completed`)
 * and navigate to `#/`. Returning users with on-disk installs skip
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
  /**
   * The launcher's bearer JWT, when the user is signed in. Used by
   * Step 1 to auto-fetch the auth key from the server so the user
   * doesn't have to paste it manually. `null` when the user is
   * signed out — Step 1 then falls back to the manual entry flow.
   */
  bearerToken?: string | null
}

export function OnboardingPage({ initialChecks, onFinish, onRefreshGate, bearerToken }: OnboardingPageProps) {
  const { t } = useTranslation()
  const totalSteps = 4

  const [step, setStep] = useState<Step>(() => {
    // Skip past the steps whose inputs are already satisfied by the
    // on-disk setup checks. The auth-key step auto-fills from the
    // server when the user is signed in (see `AccessKeyStep`'s
    // mount effect), so seeding `initialChecks.hasKey = true` here
    // is enough to skip it on first paint — there's nothing for
    // the user to confirm once the disk already has a key.
    //
    // Step 1 is only mandatory when there's no saved key yet. With
    // a saved key we drop straight to Step 2 (folder) when the
    // folder is also missing, or to Step 3/4 when the folder and
    // base game are present (the gate hook handles the all-present
    // case — `useOnboardingGate` returns `complete` and we don't
    // even mount this wizard).
    if (initialChecks.hasKey && initialChecks.hasFolder && initialChecks.hasBaseGame) return 4
    if (initialChecks.hasKey && initialChecks.hasFolder) return 3
    if (initialChecks.hasKey) return 2
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

  const { refreshFromDisk } = useGameStateContext()

  // Re-derive the "did the base game actually land on disk" answers
  // from the real filesystem whenever we reach the Finish step.
  //
  // This is the authoritative check the Finish checklist should trust.
  // Previously `hasBaseGame` / `hasMarker` were set optimistically in
  // Step 3's `onContinue`, which is a lie whenever the depot finished
  // but failed to write `manifest.json` (patch CDN unreachable) or the
  // `.zemu-install-v1` marker. The checklist then showed a green
  // "all good", Finish was enabled, and clicking it wrote
  // `onboarding_completed = true` on a machine whose gate would still
  // evaluate to `incomplete` — dropping the user back into Step 3's
  // "Sign in with Steam" card with a complete 15 GB install already on
  // disk. That is the exact loop a user reported.
  //
  // We also kick the play-page store's refresh here rather than at
  // Step 3 exit: `manifest.json` is written by Rust *after* the
  // download job reports completion, so refreshing at the moment the
  // progress bar hits 100% could still read `isInstalled() === false`.
  // By the time the user is looking at the Finish screen, the write
  // has landed.
  useEffect(() => {
    if (step !== 4) return
    let cancelled = false
    void (async () => {
      const checks = await getSetupChecks().catch(() => null)
      if (cancelled || !checks) return
      setHasBaseGame(checks.hasBaseGame)
      setHasMarker(checks.hasMarker)
      void refreshFromDisk()
    })()
    return () => {
      cancelled = true
    }
  }, [step, refreshFromDisk])

  const finish = useCallback(() => {
    // `markOnboardingCompleted` is now async (it writes the flag
    // to the Rust-side `LauncherConfig` via IPC, replacing the
    // old localStorage path). We await it inside the same `Promise.all`
    // as `onRefreshGate` so the gate's re-read sees the freshly-
    // committed `true` before the redirect effect evaluates — same
    // contract the old code aimed for, just preserved across the
    // IPC hop.
    //
    // We also push the wizard's writes into the play-page state
    // store before the route flip. Without `refreshFromDisk`, the
    // store's mount effect loaded `authKey` / `gameDirectory` /
    // `isInstalled` once — long before the user typed anything —
    // so the play page would land on `AUTH_KEY_REQUIRED` (or
    // `NEEDS_DESTINATION`) even though the wizard had just saved
    // both. The previous symptom was: click "Auth Key Required"
    // → modal pre-fills → save → button flips to "Locate PS3
    // folder" (the *next* stale value that surfaced once the
    // auth-key gate cleared). Forcing a full disk refresh here
    // makes the play page see the same world the wizard just
    // left.
    void Promise.all([
      markOnboardingCompleted(),
      onRefreshGate?.(),
      refreshFromDisk(),
    ]).then(() => {
      onFinish?.()
      if (typeof window !== 'undefined') {
        window.location.hash = '#/'
      }
    })
  }, [onFinish, onRefreshGate, refreshFromDisk])

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
                    bearerToken={bearerToken ?? null}
                    onAfterSave={() => {
                      // Push the just-saved key into the play-page
                      // state store immediately so a returning
                      // user who paused on Step 1 (e.g. clicked
                      // Back from Step 2 then routed to `/`) sees
                      // the auth-key gate cleared instead of
                      // "Auth Key Required". The full disk
                      // refresh happens again on `finish()`
                      // before the hash flip — this one is for
                      // mid-wizard navigation only.
                      void refreshFromDisk()
                    }}
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
                      // `selectDirectory` already persists the
                      // path on the Rust side, so push the
                      // updated directory + (potentially new)
                      // installed flag into the play-page store
                      // now. Without this the store's
                      // mount-time `getDirectory()` cache stays
                      // pinned at the empty default until the
                      // wizard finishes.
                      void refreshFromDisk()
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
                      // The depot just finished writing files into the
                      // install folder. We optimistically advance so the
                      // user isn't held on the progress bar, but the
                      // *authoritative* `hasBaseGame` / `hasMarker` values
                      // are re-read from disk by the Step 4 effect below —
                      // `setHasBaseGame(true)` used to be the only source
                      // for the Finish checklist, which meant a download
                      // that finished but failed to record its own
                      // `manifest.json` / `.zemu-install-v1` marker still
                      // showed a green "all good" and let the user click
                      // Finish into a gate that bounced them straight back
                      // into Step 3.
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
  /**
   * Invoked once the IPC `setAuthKey` write has resolved. The
   * parent uses this to push the freshly-saved key into the
   * play-page state store so a mid-wizard detour (Back + hash
   * flip, abort toast, etc.) doesn't strand the store on a stale
   * empty auth key. See `OnboardingPage`'s `finish` for the same
   * concern at the wizard's tail.
   */
  onAfterSave?: () => void
  /**
   * The signed-in user's bearer JWT, when available. The step
   * calls `fetchMyAuthKey` once on mount — if the server returns
   * an active key, it's saved locally and the wizard advances
   * without the user ever seeing the paste field. A `revoked`
   * key surfaces a banner explaining the situation; `null` /
   * transport error falls back to manual entry.
   */
  bearerToken: string | null
  t: (key: string, params?: Record<string, unknown>) => string
}

/**
 * `banner` variants the Step 1 card can render above the input.
 * Kept as a discriminated string so the JSX stays flat — we only
 * have three shapes (revoked, fetch-failed, none) and a banner
 * stacks onto a single component rather than splitting into
 * parallel conditional trees.
 */
type Step1Banner =
  | { kind: 'revoked' }
  | { kind: 'fetch-failed'; reason: string }
  | null

/**
 * Normalise a thrown value into a loggable string.
 *
 * Tauri IPC rejections arrive as plain strings (the `Err(String)`
 * returned by each `#[tauri::command]`), so `err.message` is usually
 * `undefined` and an `instanceof Error` check alone would drop the
 * only diagnostic we have.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function AccessKeyStep({ authKey, setAuthKey, onContinue, onAfterSave, bearerToken, t }: AccessKeyStepProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `banner` covers the cases where the server *answered* but the
  // answer doesn't let us auto-save: a `revoked` row (we refuse to
  // persist a revoked key), or a hard transport failure (we let
  // the user try the manual entry below). Plain null means the
  // server hasn't been consulted yet, or that we successfully
  // advanced past this step.
  const [banner, setBanner] = useState<Step1Banner>(null)

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      // 1. Always seed from local disk first — a returning user
      //    who has already saved a key shouldn't re-download it
      //    (and skipping this races with the network round-trip
      //    below, briefly showing an empty input).
      const onDisk = await window.launcherAPI?.getAuthKey?.()
      if (cancelled) return
      const existing = typeof onDisk === 'string' ? onDisk : ''
      if (existing.trim().length > 0) {
        setAuthKey(existing)
        setIsLoading(false)
        return
      }

      // 2. No on-disk key. If the user is signed in, ask the
      //    server for theirs. We don't ping the server for
      //    unauthenticated users (e.g. first-run before sign-in)
      //    — there's no row to fetch and the request would 401.
      if (!bearerToken) {
        setIsLoading(false)
        return
      }

      const result = await fetchMyAuthKey(bearerToken)
      if (cancelled) return

      // 2a. Active key returned: save it locally and skip past
      //     this step entirely. The user never has to type a
      //     key. `onAfterSave` mirrors the manual-save path so
      //     the play-page store picks up the change before the
      //     wizard advances.
      if (result.ok && result.key && result.status === 'active') {
        // Put the key in the input **before** attempting the write.
        //
        // This used to run after `await setAuthKey(...)`, so a failed
        // persistence left the field empty and told the user to "paste
        // it below" — even though the fetch had already succeeded and
        // we were holding the correct value. The user then had to go
        // and re-obtain a key they never saw, and the banner's
        // `save_failed` reason read as though the *fetch* had failed.
        //
        // Setting state first means a write failure degrades to
        // "here is your key, press Continue to retry" instead of
        // losing the value entirely.
        setAuthKey(result.key)
        try {
          await window.launcherAPI?.setAuthKey?.(result.key)
          if (cancelled) return
          onAfterSave?.()
          onContinue()
          return
        } catch (err) {
          // Log the real reason. A user report is often the only
          // evidence we get, and a bare `save_failed` with no
          // underlying message is undiagnosable — the backend's
          // `write_auth_key` deliberately degrades to a config-file
          // fallback, so an error here is genuinely unexpected and
          // worth surfacing in the log.
          void window.debugLog?.write(
            'onboarding',
            `step1 auto-save failed: ${describeError(err)}`,
          )
          setBanner({ kind: 'fetch-failed', reason: 'save_failed' })
          setIsLoading(false)
          return
        }
      }

      // 2b. Revoked key: refuse to save and surface a banner
      //     pointing the user at the website account settings
      //     page so they can request a restore. We deliberately
      //     don't expose the raw key value here — the user has
      //     nothing to gain from seeing a string they can't use.
      if (result.ok && result.key === null && result.status === 'revoked') {
        setBanner({ kind: 'revoked' })
        setIsLoading(false)
        return
      }

      // 2c. No key on the server (status === null and key === null)
      //     or transport failure: fall through to manual entry.
      //     The latter surfaces a softer banner so the user knows
      //     why the auto-fetch didn't fire.
      if (!result.ok) {
        setBanner({ kind: 'fetch-failed', reason: result.reason })
      }
      setIsLoading(false)
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [setAuthKey, onContinue, onAfterSave, bearerToken])

  const handleSave = async () => {
    if (isSaving || !authKey.trim()) return
    setIsSaving(true)
    setError(null)
    try {
      await window.launcherAPI?.setAuthKey?.(authKey.trim())
      // Fire-and-forget the parent callback — it pushes the just-
      // saved key into the play-page state store so the wizard's
      // finish-time refresh isn't the *only* moment the store
      // learns about the write. Not awaited so the modal-feel
      // advance (`onContinue()`) stays snappy.
      onAfterSave?.()
      onContinue()
    } catch (err) {
      // The user reported this as an unactionable "Could not save
      // the auth key. Please try again" with no further detail.
      // `write_auth_key` already logs the underlying keyring error
      // to the Rust-side debug log, but nothing correlated the two,
      // so record the renderer-side view of the failure too.
      void window.debugLog?.write(
        'onboarding',
        `step1 manual save failed: ${describeError(err)}`,
      )
      setError(t('authKey.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="space-y-4">
        {banner?.kind === 'revoked' ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              {t('onboarding.step1.revokedBanner')}{' '}
              <a
                href={LAUNCHER_CONFIG.accountSettingsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-destructive/80"
              >
                {t('onboarding.step1.revokedBannerLink')}
              </a>
            </span>
          </div>
        ) : null}

        {banner?.kind === 'fetch-failed' ? (
          <p
            role="status"
            className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
          >
            {t('onboarding.step1.fetchFallback', {
              reason: banner.reason,
            })}
          </p>
        ) : null}

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
  t: (key: string, params?: Record<string, unknown>) => string
}

function BaseGameStep({ folder, onBack, onContinue, t }: BaseGameStepProps) {
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

  // Live mirror of `pipelineState` for use inside the event handlers.
  // The handlers are registered once per `pipelineActive` transition;
  // reading the ref lets them see the current value without making
  // every transition tear down and rebuild the whole listener set.
  const pipelineStateRef = useRef<QrGateState>(pipelineState)
  useEffect(() => {
    pipelineStateRef.current = pipelineState
  }, [pipelineState])

  // True while the pipeline is mid-flight and the Tauri listeners
  // should be attached. Deliberately excludes `idle` (never started /
  // user dismissed) and `done` (download finished, wizard advancing)
  // so the subscription set is stable for the whole run.
  const pipelineActive = pipelineState !== 'idle' && pipelineState !== 'done'

  // Instrumentation: log every pipeline transition to the Rust debug
  // log. A report from a user who can't be reached for follow-up
  // questions is often the only evidence we get, and the
  // `scan_and_go_begin` storm in a previous report was only
  // interpretable after seeing which state transitions preceded it.
  useEffect(() => {
    if (pipelineState === 'idle') return
    void window.debugLog?.write(
      'onboarding',
      `step3 pipeline_state=${pipelineState} ` +
        `hasFolder=${folder ? 'yes' : 'no'} ` +
        `progress=${depotProgress ? 'yes' : 'no'}`,
    )
  }, [pipelineState, folder, depotProgress])

  // Instrumentation: log mount/unmount of Step 3. Repeated
  // `scan_and_go_begin` entries with no user action in between mean
  // the wizard is being remounted by the gate redirect rather than
  // the user retrying, and this is the only way to tell those apart
  // from the log alone.
  useEffect(() => {
    void window.debugLog?.write('onboarding', `step3 mounted folder=${folder ?? 'none'}`)
    return () => {
      void window.debugLog?.write(
        'onboarding',
        `step3 unmounted state=${pipelineStateRef.current}`,
      )
    }
  }, [folder])

  // Probe initial auth status on mount.
  useEffect(() => {
    let cancelled = false
    void window.steamApi?.loginStatus?.().then((status) => {
      if (cancelled) return
      setAccountName(status.accountName ?? null)
      // Pre-existing token → leave the gate in `'idle'` and let the
      // parent render the authed-but-not-yet-downloading action
      // card. The previous "manual-open fallback" branch that also
      // lived on this `loginStatus` resolution was removed along
      // with the rest of the Steam-instructions modal entry point;
      // see the file-level doc comment for rationale.
      //
      // The Rust side gates `authed` on the persisted
      // `onboarding_completed` flag (see `depot::get_status` and
      // `depot::compute_auth_status`), so a brand-new install that
      // happens to find a stale refresh token in the OS keychain
      // (e.g. a leftover from a previous launcher install) reports
      // `authed: false` and the wizard falls through to the QR
      // gate. Returning users with their own real token still see
      // the "Signed in as X" card immediately, because their
      // previous wizard pass wrote the flag.
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
  //
  // ## Why the dep is a ref, not `pipelineState`
  //
  // This used to depend on the *boolean expression*
  // `pipelineState === 'idle' || pipelineState === 'done'`. That value
  // only ever flips twice across the whole lifecycle, so the listener
  // set was attached on the first non-idle render and torn down on the
  // return to idle — the subscription lifecycle was decoupled from the
  // state it was tracking. We now depend on `pipelineActive` (a real
  // boolean derived from state) and read the live state through a ref
  // inside the handlers, which keeps the subscription stable across
  // `connecting → awaiting_scan → awaiting_confirm → downloading`
  // while still tearing down when the pipeline truly ends.
  //
  // ## Why the `disposed` guard matters
  //
  // Every `on*` listener in `tauri-bridge.ts` is fire-and-forget:
  // `listen()` returns a promise, so if cleanup runs before it
  // resolves, the underlying Tauri listener is never removed and can
  // fire into an unmounted component — re-running `onContinue()` and
  // re-advancing the wizard. The bridge now tears down late-resolving
  // listeners itself, and this guard is the renderer-side belt to that
  // braces.
  useEffect(() => {
    if (!pipelineActive) return
    let disposed = false
    // Read the freshest state from inside callbacks without making
    // them re-subscribe on every transition.
    const stateRef = pipelineStateRef
    const offs: Array<() => void> = []
    const offQr = window.steamApi?.onQr?.((dataUrl) => {
      if (disposed) return
      setQrDataUrl(dataUrl)
      setPipelineState('awaiting_scan')
    })
    const offScanned = window.steamApi?.onScanned?.(() => {
      if (disposed) return
      setPipelineState('awaiting_confirm')
    })
    const offAuthed = window.steamApi?.onAuthed?.((name) => {
      if (disposed) return
      setAccountName(name)
      // Drop the QR immediately so the wizard UI transitions to the
      // progress bar without flashing a stale "scan me" image.
      setQrDataUrl(null)
    })
    const offLoginError = window.steamApi?.onLoginError?.((message) => {
      if (disposed) return
      setPipelineError(message)
      setPipelineState('failed')
    })
    const offProgress = window.steamApi?.onDepotProgress?.((p) => {
      if (disposed) return
      setDepotProgress(p)
      // First progress event marks the auth → download transition.
      if (stateRef.current !== 'downloading') {
        setPipelineState('downloading')
      }
    })
    const offDone = window.steamApi?.onDepotDone?.(() => {
      if (disposed) return
      setPipelineState('done')
      setDepotProgress(null)
      onContinue()
    })
    const offDepotError = window.steamApi?.onDepotError?.((message) => {
      if (disposed) return
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
      disposed = true
      offs.forEach((off) => off())
    }
  }, [pipelineActive, onContinue, pipelineStateRef])

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

  // Convenience flags. Plain equality only — no derived state that
  // could collide with itself across renders. (`isIdle` was
  // previously derived here too — it gated the "open manual
  // instructions" button that was removed along with the rest of
  // the manual fallback.)
  const isDownloading = pipelineState === 'downloading'
  const isFailed = pipelineState === 'failed'

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
        {/*
          The bottom-bar previously rendered a secondary "Open
          instructions" button that surfaced the Steam-instructions
          modal as a manual fallback. That branch was removed
          because every supported build now drives the QR flow, so
          the only way out of Step 3 is Back / retry / let the
          download finish. Users who want the manual depot-command
          instructions can still reach them via the sidebar's
          right-click "Install PS3 Manually" entry or the
          read-only "Installation Guide" pane in the Properties
          dialog.
        */}
      </div>
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