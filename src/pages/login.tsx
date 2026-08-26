import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { AlertTriangle, DiscordFilled, Mail } from '@/components/icons'
import { useAuthContext } from '@/contexts/auth-context'
import { LAUNCHER_CONFIG } from '@/config/launcher'

/**
 * Login screen — adapted from the abyssal-gate launcher's login.tsx
 * for the zemu auth flow.
 *
 * Provider list is trimmed to what the auth app actually exposes
 * (Discord + email credentials). No register flow because
 * the launcher-side auth API doesn't ship a registration endpoint —
 * new users sign up via the website's /register page first, then sign
 * in here.
 *
 * Visual language kept 1:1 with abyssal-gate:
 *   - Dark gradient backdrop (`from-background via-background to-[#1C1A1A]`)
 *   - Stacked full-width OAuth buttons with rounded-sm corners, h-12
 *   - Email form slides down via AnimatePresence (height + opacity)
 *   - Login entry animation: fade up y=20 → 0, 400ms easeOut
 *
 * The Button `data-variant="oauth"` plumbing (Discord/Email) is
 * handled inside components/ui/button.tsx — the auth screen just
 * passes `variant="discord" | "email"` and the brand color
 * is set automatically via `--oauth`.
 */
export function LoginPage() {
  const { login, loginWithProvider } = useAuthContext()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await login(email, password)
      if (result.success) {
        setIsLoggingIn(true)
        setEmail('')
        setPassword('')
      } else {
        setError(result.error ?? 'Login failed')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleProvider = (provider: 'discord') => {
    setError(null)
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
        setError(result.error)
      }
    })
  }

  if (isLoggingIn) {
    return (
      <div className="relative flex flex-1 items-center justify-center bg-gradient-to-t from-background via-background to-[#121212]">
        <div className="flex flex-col items-center justify-center gap-4">
          <Spinner className="size-8 text-foreground" />
          <p className="text-lg text-foreground">Logging in...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-y-auto overflow-x-hidden bg-gradient-to-t from-background via-background to-[#121212]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        // `min-w-0` lets this column shrink below its intrinsic content
        // width — without it, a wide child (input, button text, brand
        // icon) can blow the column past `max-w-md`, causing the OAuth
        // stack and email form to escape the rounded card boundary.
        // `mx-auto` plus `w-full` keeps the card horizontally centered
        // up to the max width. We deliberately don't set `overflow-hidden`
        // here — the focus ring on the email input extends 3px outside
        // its bounding box via `focus-visible:ring-3`, and clipping it
        // makes the ring look cut off on the left/right edges.
        className="relative z-10 mx-auto flex w-full min-w-0 max-w-md flex-col gap-6 p-8 py-8"
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
            Login to {LAUNCHER_CONFIG.company}
          </h1>
        </div>

        {/* Error banner sits above the OAuth stack so it's visible no
            matter which entry point failed (Discord/browser
            handoff, or the email/password submit inside the form
            below). The previous version only rendered this inside the
            email form, which meant OAuth failures looked like
            nothing happened — the user just saw a button that didn't
            seem to respond. */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}

        {/* OAuth providers stacked vertically. Discord is the
            provider the auth app exposes; Email is a toggle that
            expands the credentials form below via AnimatePresence.
            Button heights override the shadcn default (h-8 → h-12) to
            match the abyssal-gate layout's tap targets. Discord
            intentionally isn't bound to `isSubmitting` — the OAuth
            dance runs out-of-process in the browser, so keeping the
            buttons clickable means the user can retry or switch
            providers if they close the tab mid-flow. Email is gated
            so the form submit can't double-fire. */}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="discord"
            onClick={() => handleProvider('discord')}
            size="lg"
            className="h-12 w-full justify-center rounded-sm"
          >
            <DiscordFilled className="!size-5" />
            Continue with Discord
          </Button>
          <Button
            type="button"
            variant="email"
            onClick={() => {
              setError(null)
              setShowEmailForm((prev) => !prev)
            }}
            disabled={isSubmitting}
            size="lg"
            className="h-12 w-full justify-center rounded-sm"
          >
            <Mail className="!size-5" />
            Continue with Email
          </Button>
        </div>

        {/* Email/password form slides down. AnimatePresence handles the
            enter/exit so the surrounding buttons don't jump. The
            abyssal-gate launcher uses height + opacity together for a
            smooth slide. */}
        <AnimatePresence mode="wait">
          {showEmailForm && (
            <motion.div
              key="email-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              // `min-w-0` so the inner inputs (which default to a
              // browser `size=20` intrinsic min-width) don't push the
              // email form past the OAuth stack's right edge. We
              // deliberately don't put `overflow-hidden` on this
              // wrapper — the input's `focus-visible:ring-3` is a
              // `box-shadow` that extends 3px outside the input
              // border, and any `overflow: hidden` ancestor would
              // chop that ring. Instead the height animation is
              // achieved by animating `height` on this div (which
              // does not need `overflow-hidden` since `height: 0`
              // already hides the children), and we add a small
              // `pb-px` below so the ring has room to render.
              className="min-w-0 pb-px"
            >
              <form onSubmit={handleEmailSubmit} className="min-w-0 space-y-4 pt-4">
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-foreground"
                  >
                    Email
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
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    Password
                  </label>
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
                  {isSubmitting ? 'Please wait...' : 'Login'}
                </Button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}