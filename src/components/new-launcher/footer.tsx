import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { FriendsSheet } from '@/components/friends-sheet'
import { InstallAuthDialog } from '@/components/new-launcher/install-auth-dialog'
import { InstallDialog } from '@/components/new-launcher/install-dialog'
import { AUTH_KEY_RETRY_EVENT } from '@/components/new-launcher/access-key-provisioner'
import { NoticeBanner } from '@/components/new-launcher/notice-banner'
import { useInstallJob } from '@/components/new-launcher/use-install-job'
import { PropertiesModal } from '@/components/properties-modal'
import { Spinner } from '@/components/ui/spinner'
import { useDownloadSpeed } from '@/hooks/use-download-speed'
import { useGameStateContext } from '@/hooks/use-game-state-context'
import { cn } from '@/lib/utils'

/**
 * Launcher footer — new launcher UI.
 *
 * Footer layout:
 *
 *   left  → the auto-sized action column: a `NETWORK` stats block
 *           (speed + %) and the patch progress bar, stacked above the
 *           Play and Settings buttons while a patch is running.
 *           Otherwise just the buttons; it only takes the width of its
 *           contents. The button row stretches to the notice column's
 *           height, so Play/Settings fill the footer column vertically.
 *   right → the live site notice (`NoticeBanner`), painted on
 *           `notice-bar-bg.png` and stretched across the remaining
 *           width. Empty when no notice is live.
 *
 * Play button:
 * - `play-active.png` is the dark-red button, `play-disabled.png` the
 *   grey one. The art carries the frame; the label is real text on top
 *   so it can change with state.
 * - The grey art is used for every *status* state — playing, checking
 *   for updates, downloading, applying, launching, verifying. Those
 *   aren't actions, so they also render a smaller label (13px vs 16px)
 *   to keep the longer messages inside the frame. Actionable states
 *   (play, update, retry, locate) keep the red art at full size.
 * - `UPDATE_AVAILABLE` keeps the red art and reads "Update" (clicks
 *   start the patch download); `UP_TO_DATE` / `UPDATE_COMPLETE` read
 *   "Play" and launch.
 * - Hover/press feedback is a brightness filter on the art only, so the
 *   label stays crisp.
 *
 * Settings button:
 * - `settings-btn.png` is the 48px square frame, `settings-icon.png` the
 *   gear that sits inside it (both rendered at native size).
 * - Opens the existing `PropertiesModal`, which previously lived in the
 *   sidebar. The modal is mounted here so the footer owns its state.
 */
const PLAY_ART = {
  active: '/btn/play-active.png',
  /** Dedicated art for the INSTALL action (green frame). */
  install: '/btn/play-install.png',
  disabled: '/btn/play-disabled.png',
} as const

const SETTINGS_ART = {
  frame: '/btn/settings-btn.png',
  icon: '/icon/settings-icon.png',
} as const

// Friends reuses the square frame from the settings button; the glyph
// is the navbar's `Friends.png` mark.
const FRIENDS_ICON = '/icon/navbar/Friends.png'

/**
 * Patch progress bar.
 *
 * `progress-bar-download.png` is a 256×9 transparent track with a 1px
 * brand-red frame, so it's stretched horizontally only and kept at its
 * native 9px height — scaling it vertically would blur the 1px border.
 * The fill is inset past the border and carries the
 * `#930303 → #e20000` gradient, which reads as the moving thumb.
 */
const PROGRESS_FRAME = '/progress-bar/progress-bar-download.png'

/**
 * `96 mbit/s` — `useDownloadSpeed` reports bytes per second (EMA-smoothed
 * across the active files), so convert to decimal megabits. Sub-10 values
 * keep one decimal so a slow patch doesn't read as "0 mbit/s".
 */
/** `NETWORK` + `96.4 mbit/s | 35%`, sitting above the progress bar. */
function formatMbits(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return '—'
  // Always one decimal: whole-number jumps (58, 76, 32) read as noise.
  return `${((bytesPerSecond * 8) / 1_000_000).toFixed(1)} mbit/s`
}

/** `NETWORK` + `96 mbit/s | 35%`, sitting above the progress bar. */
function NetworkStats({ label, speed, progress }: { label: string; speed: string; progress: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2 text-sm text-foreground">
        <span className="tabular-nums">{speed}</span>
        <span aria-hidden="true" className="text-muted-foreground/50">
          |
        </span>
        <span className="tabular-nums">{Math.round(progress)}%</span>
      </div>
    </div>
  )
}

function DownloadProgressBar({ value }: { value: number }) {
  return (
    <div
      className="relative h-[9px] w-full"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <img src={PROGRESS_FRAME} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 size-full" />
      <div className="absolute inset-x-[2px] inset-y-[2px] overflow-hidden">
        <div
          className="h-full transition-[width] duration-300 ease-out"
          style={{
            width: `${value}%`,
            backgroundImage: 'linear-gradient(90deg, #930303 0%, #e20000 100%)',
          }}
        />
      </div>
    </div>
  )
}

export function Footer({ className }: { className?: string }) {
  const { t } = useTranslation()
  const {
    state,
    gameDirectory,
    launchGame,
    startUpdate,
    selectDirectory,
    setDestination,
    patchFailed,
    checkForUpdates,
  } = useGameStateContext()
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  // Destination of the last install attempt, kept so the QR dialog's
  // "Retry" can restart the pipeline without re-asking for a folder.
  const [installPath, setInstallPath] = useState<string | null>(null)
  // Set while a resumed `patch` job is waiting for the re-check to land:
  // `startUpdate` closes over `gameDirectory`, so calling it in the same
  // tick as `setDestination` would still see the old (or null) folder.
  const [resumePatchPending, setResumePatchPending] = useState(false)
  // True while the user has closed the Steam QR panel. The pipeline keeps
  // running in the background; clicking the Play button (now reading
  // "Sign in to Steam") re-opens it.
  const [authDismissed, setAuthDismissed] = useState(false)
  // Dedupes the failure toast: one per distinct error string.
  const jobErrorShownRef = useRef<string | null>(null)

  // Shared EMA-smoothed download speed (bytes/s) so the footer and the
  // update toast agree on the number.
  const { speed, stalled } = useDownloadSpeed()

  // Client (Steam depot) download job — phase 2. The footer is the only
  // progress surface; the QR panel is its own dialog.
  const job = useInstallJob()
  // Auth is *not* progress: nothing is downloading yet, so the bar stays
  // hidden until the depot stage actually starts.
  const authPending = job.stage === 'auth'
  const clientDownloading = job.stage === 'client'
  // Destructured for the callbacks/effects below: depending on the whole
  // `job` object would re-run them on every render.
  const {
    stage: jobStage,
    error: jobError,
    reset: resetJob,
    resumable,
    start: startJob,
    clearRecord,
  } = job

  // The game is running — grey art, no click.
  const isPlaying = state.type === 'PLAYING'

  // Any in-flight action: refuse clicks so a double-click can't start a
  // second download / launch.
  const isBusy =
    state.type === 'CHECKING_FOR_UPDATE' ||
    state.type === 'DOWNLOADING_UPDATE' ||
    state.type === 'APPLYING_PATCH' ||
    state.type === 'VERIFYING_INTEGRITY' ||
    state.type === 'LAUNCHING_GAME'

  // Auth is clickable (it re-opens the QR panel); the depot download is
  // not, because there is nothing to click while bytes are moving.
  // `starting` covers the moment before Rust says whether the saved Steam
  // session is usable — disabling avoids a double-start.
  const starting = job.stage === 'starting'
  // Signed in, fetching the depot manifest — no bytes yet, so no bar.
  const preparing = job.stage === 'preparing'
  // The install job failed (Steam login timed out, depot error, …). Without
  // this the footer silently fell back to the *game state* label and showed
  // "INSTALL PATCH" for an install that never downloaded anything.
  const jobFailed = job.stage === 'error'
  // Clicking during `starting` only re-opens the panel — it must not start a
  // second pipeline, so it isn't part of `disabled`.
  const disabled = isPlaying || isBusy || clientDownloading || preparing

  // Status states (checking, downloading, launching, playing…) are not
  // actions: they get the grey disabled art and a smaller label so the
  // longer messages fit inside the frame.
  const isStatus = disabled

  // A job left behind by a previous session takes precedence over
  // PLAY/INSTALL — but only when a destination is configured. With no path
  // the entry point must be INSTALL; a leftover record would otherwise show
  // RESUME for an install the user already cleared.
  const canResume =
    !disabled && jobStage === 'idle' && resumable !== null && gameDirectory !== null

  // Progress surfaces: the patch stage comes from game state, the client
  // download from the install job. The auth stage has neither — showing a
  // 0 % bar while the QR is still on screen looked like a broken download.
  const isPatching = state.type === 'DOWNLOADING_UPDATE'
  const progress = isPatching ? Math.min(100, Math.max(0, state.updateStatus.overallProgress)) : 0
  const showProgress = isPatching || clientDownloading
  // Indeterminate work with nothing else moving: the spinner is the only
  // feedback for these (checking, applying, verifying, launching, preparing).
  // Downloads already have the bar, and PLAYING isn't work at all.
  const showSpinner = isStatus && !showProgress && state.type !== 'PLAYING'
  // The button is in its INSTALL state (no destination configured). Drives
  // the green hue shift on the frame art.
  const installAction = state.type === 'NEEDS_DESTINATION'
  const barValue = isPatching ? progress : job.percent
  const barSpeed = clientDownloading
    ? job.speedBps > 0
      ? job.speedBps
      : null
    : stalled
      ? null
      : speed

  const label = (() => {    // The Steam panel is on screen for both of these, so the label names the
    // panel instead of inventing a third "Starting…" state.
    if (starting || authPending) return t('installDialog.signIn')
    if (preparing) return t('play.preparing')
    if (jobFailed) return t('play.retryInstall')
    if (clientDownloading) return t('play.downloading')
    if (canResume) return t('play.resume')
    switch (state.type) {
      case 'PLAYING':
        return t('play.playing')
      case 'LAUNCHING_GAME':
        return t('play.launchingGame')
      case 'CHECKING_FOR_UPDATE':
        return t('play.checking')
      case 'UPDATE_AVAILABLE':
        // `NOT_INSTALLED` means the folder has no patch yet — same action,
        // different word ("Install patch" vs "Update").
        return state.reason === 'NOT_INSTALLED' ? t('play.installPatch') : t('play.update')
      case 'DOWNLOADING_UPDATE':
      case 'APPLYING_PATCH':
        // Progress lives in the bar above the button, so the label stays
        // a plain status word.
        return t('play.patching')
      case 'VERIFYING_INTEGRITY':
        return t('play.verifying')
      case 'AUTH_KEY_REQUIRED':
        // No label of its own anymore (plan D3): the access key is
        // provisioned on sign-in, so this is a retry, not a gate.
        return t('play.play')
      case 'NEEDS_DESTINATION':
        // No install folder yet: the button owns the install, so open
        // the destination dialog instead of dropping straight into a
        // folder picker.
        return t('play.install')
      case 'ERROR':
        // A failed patch keeps the downloaded client, so the label says
        // exactly what the click will do.
        return patchFailed ? t('play.retryPatch') : t('play.retry')
      default:
        return t('play.play')
    }
  })()

  // Resume an interrupted install. `client` restarts the depot stage (the
  // downloader skips files already on disk); `patch` only needs the patch.
  const handleResume = useCallback(async () => {
    if (!resumable) return
    if (resumable.stage === 'client') {
      void startJob(resumable.destination)
      return
    }
    const applied = await setDestination(resumable.destination)
    if (!applied) return
    await clearRecord()
    // The effect below starts the patch once the fresh check resolves.
    setResumePatchPending(true)
  }, [resumable, startJob, setDestination, clearRecord])

  const handlePlay = useCallback(() => {
    if (jobFailed) {
      // Restart the client download from the last destination. The depot
      // downloader skips files that already landed.
      if (installPath) void startJob(installPath)
      else setInstallOpen(true)
      return
    }
    if (starting || authPending) {
      // The panel is already open; this re-opens it after a dismissal.
      setAuthDismissed(false)
      return
    }
    if (canResume) {
      void handleResume()
      return
    }
    switch (state.type) {
      case 'UPDATE_AVAILABLE':
        startUpdate()
        return
      case 'UP_TO_DATE':
      case 'UPDATE_COMPLETE':
        void launchGame()
        return
      case 'NEEDS_DESTINATION':
        setInstallOpen(true)
        return
      case 'AUTH_KEY_REQUIRED':
        // Ask the provisioner to fetch the key again. It was moved out of
        // onboarding (plan D3) and runs silently on sign-in, so this is
        // only reached after a failed attempt.
        window.dispatchEvent(new CustomEvent(AUTH_KEY_RETRY_EVENT))
        return
      case 'ERROR':
        // Two very different failures share this state:
        // - patch stage failed → retry the patch only; the client is on disk
        //   and re-running the depot would waste 14 GB,
        // - anything else → re-check disk/CDN state, which clears `error`.
        if (patchFailed) {
          void startUpdate().catch(() => undefined)
        } else {
          void checkForUpdates(true)
        }
        return
      default:
        return
    }
  }, [
    jobFailed,
    installPath,
    startJob,
    starting,
    authPending,
    canResume,
    handleResume,
    state.type,
    startUpdate,
    launchGame,
    patchFailed,
    checkForUpdates,
  ])

  // Client stage finished → hand over to the patch stage.
  //
  // `job.reset()` puts the job back to idle so the footer switches from
  // the client bar to the game-state bar (`DOWNLOADING_UPDATE`) without
  // a frame of both. Killing the launcher here is safe: the depot files
  // are on disk and the patch re-checks from disk.
  useEffect(() => {
    if (jobStage !== 'done') return
    resetJob()
    // `startUpdate` throws if the directory vanished mid-install; the
    // hook toasts its own failures, so don't let the rejection escape.
    void startUpdate().catch(() => undefined)
  }, [jobStage, resetJob, startUpdate])

  // Once the patch reports the install is current, the job record has
  // served its purpose — drop it so RESUME can't linger.
  useEffect(() => {
    if (!resumable) return
    if (state.type === 'UP_TO_DATE' || state.type === 'UPDATE_COMPLETE') {
      void clearRecord()
    }
  }, [resumable, state.type, clearRecord])

  // Resumed `patch` job: wait for the destination's fresh check, then run
  // the patch. If it turns out to be current already, just drop the flag.
  useEffect(() => {
    if (!resumePatchPending) return
    if (state.type === 'UP_TO_DATE' || state.type === 'UPDATE_COMPLETE') {
      setResumePatchPending(false)
      return
    }
    if (state.type !== 'UPDATE_AVAILABLE') return
    setResumePatchPending(false)
    void startUpdate().catch(() => undefined)
  }, [resumePatchPending, state.type, startUpdate])

  // Leaving the auth stage retires the dismissal flag, so the next install
  // starts with the QR panel visible again.
  useEffect(() => {
    if (!authPending) setAuthDismissed(false)
  }, [authPending])

  // Surface install-job failures. Before this, the QR panel just closed and
  // the button fell back to the game-state label with no explanation.
  useEffect(() => {
    if (jobStage !== 'error' || !jobError) return
    if (jobErrorShownRef.current === jobError) return
    jobErrorShownRef.current = jobError
    toast.error(t('toasts.installFailed'), { description: jobError })
  }, [jobStage, jobError, t])

  // A new attempt must be able to report the same error again.
  useEffect(() => {
    if (jobStage !== 'error') jobErrorShownRef.current = null
  }, [jobStage])

  return (
    <footer className={cn('shrink-0 px-6 pb-6', className)}>
      <div className="flex items-stretch gap-3">
        {/* Action column is sized by its content (buttons row) instead of
            a fixed width — with three buttons a hardcoded width overflows
            into the notice banner. The notice takes whatever is left. */}
        <div className="flex shrink-0 flex-col gap-3">
          {/* Action column — network stats land above the buttons too. */}
          {showProgress && (
            <div className="flex flex-col gap-2">
              <NetworkStats label={t('play.network')} speed={formatMbits(barSpeed)} progress={barValue} />
              <DownloadProgressBar value={barValue} />
            </div>
          )}
          <div className="flex min-h-[66px] flex-1 items-stretch gap-3">
            <button
              type="button"
              onClick={handlePlay}
              disabled={disabled}
              className={cn(
                'group relative h-full w-[272px] shrink-0 select-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                disabled ? 'cursor-default' : 'cursor-pointer',
              )}
            >
              <img
                src={isStatus ? PLAY_ART.disabled : installAction ? PLAY_ART.install : PLAY_ART.active}
                alt=""
                aria-hidden="true"
                draggable={false}
                className={cn(
                  'absolute inset-0 size-full object-contain transition-[filter] duration-150 ease-out',
                  !disabled && 'group-hover:brightness-110 group-active:brightness-95',
                )}
              />
              <span
                className={cn(
                  'relative z-10 flex size-full items-center justify-center gap-2 px-3 text-center',
                  'font-bold uppercase',
                  isStatus
                    ? 'text-[12px] leading-tight tracking-[0.1em] text-white/60'
                    : 'text-[16px] tracking-[0.14em] text-white',
                )}
              >
                {showSpinner ? <Spinner className="size-3.5 shrink-0" /> : null}
                <span className="truncate">{label}</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPropertiesOpen(true)}
              aria-label={t('play.properties')}
              title={t('play.properties')}
              className={cn(
                'group relative grid h-full w-[66px] shrink-0 place-items-center',
                'cursor-pointer select-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              )}
            >
              <img
                src={SETTINGS_ART.frame}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="absolute inset-0 size-full object-contain transition-[filter] duration-150 ease-out group-hover:brightness-110 group-active:brightness-95"
              />
              <img src={SETTINGS_ART.icon} alt="" aria-hidden="true" draggable={false} className="relative size-6" />
            </button>

            <button
              type="button"
              onClick={() => setFriendsOpen(true)}
              aria-label={t('nav.friends')}
              title={t('nav.friends')}
              className={cn(
                'group relative grid h-full w-[66px] shrink-0 place-items-center',
                'cursor-pointer select-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              )}
            >
              <img
                src={SETTINGS_ART.frame}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="absolute inset-0 size-full object-contain transition-[filter] duration-150 ease-out group-hover:brightness-110 group-active:brightness-95"
              />
              <img
                src={FRIENDS_ICON}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="relative w-7"
              />
            </button>
          </div>
        </div>

        {/* Right column — live site notice, stretched to the remaining width. */}
        <div className="flex min-w-0 flex-1 items-end">
          <NoticeBanner />
        </div>
      </div>

      <PropertiesModal
        open={propertiesOpen}
        onOpenChange={setPropertiesOpen}
        gameDirectory={gameDirectory}
        onChangeFolder={() => void selectDirectory()}
      />

      <FriendsSheet open={friendsOpen} onOpenChange={setFriendsOpen} />

      <InstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={(path) => {
          // Client download first; the effect below starts the patch once
          // the depot stage reports done.
          setInstallPath(path)
          setAuthDismissed(false)
          void job.start(path)
        }}
      />

      <InstallAuthDialog
        // Opens on click — waiting for the QR inside the panel beats a
        // "Starting…" label with nothing on screen. It also stays open for a
        // login failure so the error is visible where the code was.
        open={
          !authDismissed &&
          (starting || authPending || (jobFailed && job.qrDataUrl !== null))
        }
        connecting={starting && job.qrDataUrl === null}
        qrDataUrl={job.qrDataUrl}
        accountName={job.accountName}
        error={job.error}
        onRetry={() => {
          if (installPath) void job.start(installPath)
        }}
        onOpenChange={(next) => {
          // Dismissing only hides the code — the pipeline keeps running and
          // the button (now "Sign in to Steam") re-opens it.
          if (!next) setAuthDismissed(true)
        }}
      />
    </footer>
  )
}
