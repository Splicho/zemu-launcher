import type { TFunction } from 'i18next'

/**
 * Translate an auth-flow error code (`user_banned`, `session_missing`,
 * etc.) into a localized, user-facing message suitable for rendering in
 * the login banner.
 *
 * Server-side error codes arrive here through two paths:
 *
 *   - OAuth (Discord/Steam): the auth app's
 *     `/api/launcher/oauth/complete` route 302s the launcher's
 *     loopback with `?error=<code>&state=…`. Rust surfaces `code`
 *     as the `error` field of the `oauth-callback` Tauri event;
 *     `awaitOAuthCallback` rejects with `new Error(code)`, and
 *     `useAuth.loginWithProvider` resolves with `{ success: false,
 *     error: code }`.
 *
 *   - Credentials (`POST /api/launcher/auth/login`): the auth app
 *     returns `{ error: 'user_banned' }` with a 403. The renderer
 *     throws `new Error(payload.error ?? 'Login failed (HTTP …)')`
 *     and `useAuth.login` resolves with `{ success: false, error:
 *     err.message }`.
 *
 * Both paths end up feeding the same `error` state in
 * `pages/login.tsx`. Without this translation the user sees the
 * literal snake_case code in the banner — which looks like a
 * dev-mode leak rather than a real message.
 *
 * The returned shape is two strings:
 *
 *   - `title` is the headline (rendered in `text-destructive`
 *     `font-medium`) — the user should immediately understand what
 *     went wrong.
 *   - `description` is an optional subtitle (rendered in
 *     `text-muted-foreground`) — typically a call to action or
 *     contact info. Empty string when the locale doesn't ship a
 *     secondary line.
 *
 * Each locale declares two flat keys per error code —
 * `login.errors.<code>_title` and `login.errors.<code>_desc` —
 * mirroring the website's `<OAuthErrorBanner>` layout. The
 * `_title`/`_desc` suffix is the i18next convention for "two-line"
 * entries; nesting into an object would force callers to type-narrow
 * against `t`'s polymorphic return.
 *
 * The fallback path substitutes the raw `code` into the title and
 * shows the code in the description so an unhandled error is at
 * least visible + greppable from a screenshot. The error code list
 * mirrors the launcher's known failure modes and must be kept in
 * lockstep with `apps/auth/app/api/launcher/oauth/complete/route.ts`
 * and `apps/auth/app/api/launcher/auth/login/route.ts`.
 *
 * @param t  The i18next translator from `useTranslation()`.
 * @param error The raw error string from the auth client. Any
 *   non-string value (e.g. `undefined`) returns `null` so callers
 *   can render the banner conditionally.
 */
export interface AuthErrorMessage {
  title: string
  description: string
}

export function formatAuthError(
  t: TFunction,
  error: string | null | undefined,
): AuthErrorMessage | null {
  if (!error) return null

  const titleKey = `login.errors.${error}_title`
  const descKey = `login.errors.${error}_desc`

  const title = t(titleKey)
  const description = t(descKey)

  // i18next's `returnNull: false` (see `lib/i18n.ts`) means an
  // unknown key resolves to the key itself — useful as a built-in
  // fallback detector. If both keys missed, surface the configured
  // fallback pair with the raw code so an unhandled error is still
  // visible + greppable.
  if (title === titleKey && description === descKey) {
    return {
      title: t('login.errors.fallback_title', { code: error }),
      description: t('login.errors.fallback_desc', { code: error }),
    }
  }
  // Only the title key hit. Either the locale intentionally omits
  // a subtitle (description slot stays empty), or the desc key is
  // malformed — drop the raw key from the description to avoid
  // showing a snake_case artefact in the muted slot.
  return {
    title,
    description: description === descKey ? '' : description,
  }
}
