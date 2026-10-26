import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ProviderButton } from '@/components/provider-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { CircleAlert, DiscordFilled, Mail, Steam } from '@/components/icons'
import { useAuthContext } from '@/contexts/auth-context'
import { useLastUsedProvider } from '@/hooks/use-last-used-provider'
import { formatAuthError, type AuthErrorMessage } from '@/lib/auth-errors'
import { LAUNCHER_CONFIG } from '@/config/launcher'
import { GAME_BACKGROUNDS, GAME_BACKGROUND_INTERVAL_MS } from '@/config/backgrounds'
import { useRotatingImage } from '@/hooks/use-rotating-image'
import type { Provider } from '@/lib/auth'

// Accent per login option. Steam uses its client-blue rather than the
// navy from its logo, which disappears against the dark backdrop; email
// borrows the launcher's own red.
const PROVIDER_BRANDS = {
  discord: '#5865F2',
  steam: '#1A9FFF',
  email: 'oklch(0.55 0.19 29.11)',
} as const

function LoginBackground() {
  const background = useRotatingImage(
    GAME_BACKGROUNDS,
    GAME_BACKGROUND_INTERVAL_MS,
  )

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <AnimatePresence initial={false}>
        <motion.img
          key={background}
          src={background}
          alt=""
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: 1.5, ease: 'easeInOut' },
            scale: {
              duration: GAME_BACKGROUND_INTERVAL_MS / 1000 + 1.5,
              ease: 'linear',
            },
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>
      {/* Darken the screenshots so the card stays readable on bright
          scenes (sunsets, snow), with a vignette behind the card and a
          fade into the app background at the bottom edge. */}
      <div className="absolute inset-0 bg-background/55" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--background)_0%,transparent_65%)] opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
    </div>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const { login, loginWithProvider } = useAuthContext()
  const { lastUsedProvider, saveLastUsedProvider } = useLastUsedProvider()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<AuthErrorMessage | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  // Wrap setError so any value coming back from the auth client is
  // passed through the i18n mapping before it hits the banner. The
  // auth client returns raw server-side codes (`user_banned`,
  // `session_missing`, etc.); without this mapping the user sees
  // the literal snake_case string in the UI, which looks like a
  // dev-mode leak. See `lib/auth-errors.ts` for the full mapping.
  const setAuthError = (code: string | null | undefined) => {
    setError(formatAuthError(t, code))
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    setIsSubmitting(true)
    // Record the user's preferred login surface. We save *before*
    // the network call (rather than on success) because a returning
    // user who picks the same method every launch still benefits
    // from the badge even when today's attempt fails — see
    // `useLastUsedProvider` for the rationale. Same pattern for
    // OAuth in `handleProvider`.
    saveLastUsedProvider('email')
    try {
      const result = await login(email, password)
      if (result.success) {
        setIsLoggingIn(true)
        setEmail('')
        setPassword('')
      } else {
        setAuthError(result.error ?? 'loginFailed')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleProvider = (provider: Provider) => {
    setAuthError(null)
    // Record the user's preferred login surface *before* kicking off
    // the OAuth flow. We don't gate on `success` here either —
    // returning users tend to keep using the same provider even
    // when individual attempts fail, and the badge should point at
    // the button they actually clicked last, not at the button that
    // happened to succeed.
    saveLastUsedProvider(provider)
    // Fire-and-forget. `loginWithProvider` awaits the entire OAuth
    // dance (browser handoff → user consents → callback event → token
    // exchange), which can take minutes if the user walks away. Holding
    // `isSubmitting` true for that whole window pins the buttons as
    // disabled, so if the user closes the tab mid-flow they're stuck
    // staring at a dead-looking UI until the 5-min timeout fires.
    // The hook itself owns `status` and flips it to `'authed'` when
    // the dance succeeds, or back to `'auth'` with an error message
    // when it fails — so we don't need to wait here.
    void loginWithProvider(provider).then((result) => {
      if (!result.success && result.error) {
        setAuthError(result.error)
      }
    })
  }

  if (isLoggingIn) {
    return (
      <div className="relative flex flex-1 items-center justify-center bg-gradient-to-t from-background via-background to-[#121212]">
        <div className="flex flex-col items-center justify-center gap-4">
          <Spinner className="size-8 text-foreground" />
          <p className="text-lg text-foreground">{t('login.loggingIn')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-y-auto overflow-x-hidden bg-background">
      <LoginBackground />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        // `min-w-0` lets this column shrink below its intrinsic content
        // width — without it, a wide child (input, button text, brand
        // icon) can blow the column past the max width, causing the
        // OAuth stack and email form to escape the rounded card
        // boundary. `mx-auto` plus `w-full` keeps the card
        // horizontally centered up to the max width. We deliberately
        // don't set `overflow-hidden` here — the focus ring on the
        // email input extends 3px outside its bounding box via
        // `focus-visible:ring-3`, and clipping it makes the ring look
        // cut off on the left/right edges.
        //
        // `max-w-lg` (32rem) is the wider card the launcher uses for
        // its other forms (onboarding, settings) — `max-w-md` (28rem)
        // started to feel cramped once the destructive error banner
        // started rendering its two-line layout (title +
        // muted-foreground description), especially when the
        // description is a full sentence like the `user_banned`
        // appeal message. Going wider here keeps the wrap point well
        // clear of the icon column.
        className="relative z-10 mx-auto flex w-full min-w-0 max-w-lg flex-col gap-6 p-8 py-8"
      >
        {/* Logo + title. The app icon path is bundled by Tauri's
            resource bundler; falls back to a transparent slot if the
            asset isn't present yet. */}
        <div className="flex flex-col items-center gap-4 text-center">
          <img
            src="./assets/icon/app-icon.ico"
            alt={LAUNCHER_CONFIG.company}
            className="mx-auto h-16 w-16"
          />
          <h1 className="text-2xl font-semibold text-foreground">
            {t('login.loginTo', { company: LAUNCHER_CONFIG.company })}
          </h1>
        </div>

        {/* Error banner sits above the OAuth stack so it's visible no
            matter which entry point failed (Discord/browser
            handoff, or the email/password submit inside the form
            below). The previous version only rendered this inside the
            email form, which meant OAuth failures looked like
            nothing happened — the user just saw a button that didn't
            seem to respond.

            The two-line layout mirrors the website's
            `<OAuthErrorBanner>`: a destructive-border card with a
            circle-alert icon on the left, a bold headline in
            `text-destructive` and an optional muted-foreground
            subtitle below. The subtitle is omitted when the locale
            doesn't ship a secondary line (the `_desc` key missed)
            so simple codes still render cleanly. */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1">
              <p className="font-medium text-destructive">{error.title}</p>
              {error.description ? (
                <p className="text-muted-foreground">{error.description}</p>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Each button is wrapped in a `relative` container so the
              "Last used" badge can absolutely-position itself at the
              top-right corner, sitting half-on-half-off the button's
              rounded border. The badge is keyed off the
              `lastUsedProvider` value read once on mount (see
              `use-last-used-provider.ts`), so it doesn't flicker
              between clicks — only between sessions. */}
          <ProviderButton
            brand={PROVIDER_BRANDS.discord}
            icon={<DiscordFilled />}
            label={t('login.continueDiscord')}
            hint={lastUsedProvider === 'discord' ? t('login.lastUsed') : null}
            onClick={() => handleProvider('discord')}
          />
          <ProviderButton
            brand={PROVIDER_BRANDS.steam}
            icon={<Steam />}
            label={t('login.continueSteam')}
            hint={lastUsedProvider === 'steam' ? t('login.lastUsed') : null}
            onClick={() => handleProvider('steam')}
          />
          <ProviderButton
            brand={PROVIDER_BRANDS.email}
            icon={<Mail />}
            label={t('login.continueEmail')}
            hint={lastUsedProvider === 'email' ? t('login.lastUsed') : null}
            active={showEmailForm}
            aria-expanded={showEmailForm}
            onClick={() => {
              setAuthError(null)
              setShowEmailForm((prev) => !prev)
            }}
            disabled={isSubmitting}
          />
        </div>


        <AnimatePresence mode="wait">
          {showEmailForm && (
            <motion.div
              key="email-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="min-w-0 pb-px"
            >
              <form onSubmit={handleEmailSubmit} className="min-w-0 space-y-4 pt-4">
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('login.email')}
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isSubmitting}
                    className="h-11 text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="text-sm font-medium text-foreground"
                    >
                      {t('login.password')}
                    </label>
                    <a
                      href={`${LAUNCHER_CONFIG.apiBaseUrl}/forgot-password`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t('login.forgotPassword')}
                    </a>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isSubmitting}
                    minLength={8}
                    className="h-11 text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  size="lg"
                  variant="gradient"
                  className="h-11 w-full rounded-lg"                >
                  {isSubmitting ? t('login.pleaseWait') : t('login.loginBtn')}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  {t('login.noAccount')}{' '}
                  <a
                    href={`${LAUNCHER_CONFIG.apiBaseUrl}/register`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('login.createAccount')}
                  </a>
                </p>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}