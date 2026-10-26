import type { TFunction } from 'i18next'

/**
 * Structured, actionable errors from the Rust backend.
 *
 * `src-tauri/src/errors.rs` classifies every Steam / depot / disk failure
 * into a stable {@link ErrorCode} and emits it as this payload on the
 * `steam-error` and `depot-error` Tauri events (and as the rejection value
 * of `steam_install_depot`). The renderer never displays the raw message
 * on its own: `errors.<code>.title` / `.description` live in the locale
 * files, and the original Rust chain is kept in `detail` for the
 * collapsible "Technical details" block and for support requests.
 *
 * Why the indirection: the backend cannot localize (it doesn't know the
 * renderer's language), and the old code surfaced raw protocol text like
 * `fetching depot decryption key: depot access denied: depot 433851` —
 * technically accurate, useless to a player. A stable code also lets us
 * attach the right recovery action ("use another account" vs "retry").
 */

/**
 * Every code the backend can emit. Kept in lockstep with
 * `ErrorCode::as_str()` in `src-tauri/src/errors.rs`; the Rust unit test
 * `wire_codes_are_stable` pins the same list.
 */
export const KNOWN_ERROR_CODES = [
  'steam_depot_not_owned',
  'steam_not_signed_in',
  'steam_session_expired',
  'steam_login_failed',
  'steam_account_missing',
  'steam_busy',
  'steam_rate_limited',
  'steam_network',
  'steam_cdn_auth',
  'steam_manifest_unavailable',
  'disk_full',
  'disk_permission',
  'disk_error',
  'keychain_error',
  'unknown',
] as const

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number]
/**
 * Wire code. Kept wide (`string`) on purpose: a newer backend may emit a
 * code this renderer doesn't know yet, and that must degrade to the
 * backend's English message instead of failing the type-check.
 */
export type ErrorCode = string

export interface AppErrorPayload {
  code: ErrorCode
  /** English fallback copy from the backend. */
  message: string
  /** Raw Rust error chain — technical detail, never the primary copy. */
  detail: string
  /** Whether repeating the same action could succeed unchanged. */
  retryable: boolean
}

export interface FormattedAppError {
  title: string
  description: string
  code: ErrorCode
  detail: string
  retryable: boolean
}

/**
 * Coerce anything that can come out of `invoke()` / an event / a thrown
 * value into {@link AppErrorPayload}. Handles the three real shapes:
 *
 *   - the structured payload (current backend),
 *   - a plain string (older backend builds, or an event emitted before this
 *     change landed — keeps the app working across a partial upgrade),
 *   - a JS `Error` from the command bridge.
 */
export function normalizeAppError(input: unknown): AppErrorPayload {
  if (typeof input === 'string') {
    return { code: 'unknown', message: input, detail: input, retryable: true }
  }
  if (input instanceof Error) {
    return {
      code: 'unknown',
      message: input.message,
      detail: input.stack ?? input.message,
      retryable: true,
    }
  }
  if (input && typeof input === 'object') {
    const raw = input as Record<string, unknown>
    const detail =
      typeof raw.detail === 'string'
        ? raw.detail
        : typeof raw.message === 'string'
          ? raw.message
          : ''
    const message = typeof raw.message === 'string' ? raw.message : detail
    const code =
      typeof raw.code === 'string' && raw.code.length > 0 ? raw.code : 'unknown'
    return {
      code,
      message,
      detail,
      retryable: typeof raw.retryable === 'boolean' ? raw.retryable : true,
    }
  }
  return {
    code: 'unknown',
    message: String(input ?? ''),
    detail: String(input ?? ''),
    retryable: true,
  }
}

/**
 * Resolve localized copy for a payload.
 *
 * i18next is configured with `returnNull: false`, so a missing key resolves
 * to the key itself — that doubles as the "is this code translated?" probe.
 * When the title is missing we fall back to the backend's English message
 * (which is at least human-readable), and only then to the generic
 * `errors.unknown` copy.
 */
export function formatAppError(t: TFunction, error: AppErrorPayload): FormattedAppError {
  const titleKey = `errors.${error.code}.title`
  const descriptionKey = `errors.${error.code}.description`

  const translatedTitle = t(titleKey)
  const translatedDescription = t(descriptionKey)

  const title =
    translatedTitle === titleKey
      ? error.message || t('errors.unknown.title')
      : translatedTitle
  const description =
    translatedDescription === descriptionKey ? '' : translatedDescription

  return {
    title,
    description,
    code: error.code,
    detail: error.detail,
    retryable: error.retryable,
  }
}

/**
 * Codes where the fix is "authenticate as a different Steam account", not
 * "retry". The wizard renders a "Sign in with another account" action for
 * these and keeps the plain retry secondary.
 */
const ACCOUNT_RELATED_CODES = new Set<string>([
  'steam_depot_not_owned',
  'steam_not_signed_in',
  'steam_session_expired',
  'steam_account_missing',
  'steam_login_failed',
])

export function shouldSuggestAnotherAccount(code: ErrorCode): boolean {
  return ACCOUNT_RELATED_CODES.has(code)
}

/** Store page for the game, opened from the "not owned" error card. */
export const H1Z1_STORE_URL = 'https://store.steampowered.com/app/433850/'
