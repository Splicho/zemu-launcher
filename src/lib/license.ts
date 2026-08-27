/**
 * License validation client + key formatting.
 *
 * Talks to the public NestJS API at
 * `{licenseApiBaseUrl}/v1/licenses/{validate,redeem}`. Both endpoints
 * are intentionally unauthenticated (the keyspace is 100 bits — brute
 * force is infeasible), so we just need the user's PC identifier
 * (generated and persisted by the Rust side) plus the key they pasted.
 *
 *   - `validateLicense` — idempotent: returns valid if the key is bound
 *     to this PC, OR binds the key on first-use. Used by giveaway
 *     winners whose keys were pre-bound by the website.
 *   - `redeemLicense` — bind-on-first-use, same shape as validate.
 *     Used when the user pastes a fresh key on a new install. The
 *     server no longer cares whether the key has a Discord user
 *     stamped on it — giveaway winners are the canonical user of
 *     this endpoint.
 *
 * Two outcomes matter for each:
 *   - `{ valid: true, licenseKey, discordUserId }` — the key is bound
 *     to this PC (or was already bound to this PC; both endpoints are
 *     idempotent). Cache the result.
 *   - `{ valid: false, reason: 'not_found' | 'revoked' | 'already_bound' }`
 *     — surface a localized message in the Properties > License tab.
 *
 * Network failures fall through to the caller (we don't throw — the
 * caller wants to keep the cached record and re-attempt later). The
 * hook layer is the one that decides whether to clear the cache on
 * network error.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'

export interface ValidateRequest {
  licenseKey: string
  pcIdentifier: string
}

export type ValidateFailureReason =
  | 'not_found'
  | 'revoked'
  | 'already_bound'

export type RedeemFailureReason =
  | 'not_found'
  | 'revoked'
  | 'already_bound'

export type ValidateSuccess = {
  valid: true
  licenseKey: string
  discordUserId: string | null
}

export type ValidateFailure = {
  valid: false
  reason: ValidateFailureReason
}

export type RedeemFailure = {
  valid: false
  reason: RedeemFailureReason
}

export type ValidateResponse = ValidateSuccess | ValidateFailure
export type RedeemResponse = ValidateSuccess | RedeemFailure

/**
 * Result type the caller sees. The HTTP-shape (thrown on transport
 * failure) is deliberately hidden behind this discriminated union so
 * the hook layer doesn't have to think about fetch errors vs server
 * errors separately.
 */
export type ValidateOutcome =
  | { kind: 'ok'; response: ValidateSuccess }
  | { kind: 'denied'; response: ValidateFailure }
  | { kind: 'unreachable' }

export type RedeemOutcome =
  | { kind: 'ok'; response: ValidateSuccess }
  | { kind: 'denied'; response: RedeemFailure }
  | { kind: 'unreachable' }

const LICENSE_KEY_GROUP_LEN = 5
const LICENSE_KEY_GROUP_COUNT = 4
const LICENSE_KEY_TOTAL_LEN = LICENSE_KEY_GROUP_LEN * LICENSE_KEY_GROUP_COUNT
// Crockford base32 alphabet (no I, L, O, U) — matches what the website's
// key generator uses. Numbers are accepted as-is; lowercase letters are
// uppercased before validation.
const LICENSE_KEY_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{20}$/

/**
 * Resolve the license API base URL.
 *
 * Precedence (first wins):
 *   1. `VITE_LICENSE_API_BASE_URL` set in `.env.local` (Vite dev only).
 *   2. `LAUNCHER_CONFIG.licenseApiBaseUrl` — bundled default of
 *      `https://api.zemu.uk`.
 *
 * (No Rust-side override here — the website's API URL is bundled; we
 * don't expect runtime overrides like we do for the Auth.js endpoint.)
 */
async function getApiBaseUrl(): Promise<string> {
  const fromEnv = import.meta.env.VITE_LICENSE_API_BASE_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv.replace(/\/$/, '')
  return LAUNCHER_CONFIG.licenseApiBaseUrl.replace(/\/$/, '')
}

/**
 * Shared POST-then-parse for `/v1/licenses/{validate,redeem}`. Both
 * endpoints take the same request body and return the same shape
 * (`{ valid, ... }`) up to the discriminator on `reason`. The optional
 * `expectedReasons` set narrows the set of reasons we'll accept as a
 * server-deny; anything else is collapsed into `unreachable` so the
 * caller doesn't silently treat a contract drift as a real response.
 */
async function postLicenseEndpoint<
  F extends string,
  R extends { kind: 'ok'; response: ValidateSuccess } | { kind: 'denied'; response: { valid: false; reason: F } } | { kind: 'unreachable' },
>(path: string, request: ValidateRequest, expectedReasons: readonly F[]): Promise<R> {
  const base = await getApiBaseUrl()
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { kind: 'unreachable' } as R
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { kind: 'unreachable' } as R
  }

  if (typeof payload !== 'object' || payload === null) {
    return { kind: 'unreachable' } as R
  }

  const obj = payload as Record<string, unknown>
  if (obj.valid === true) {
    return {
      kind: 'ok',
      response: {
        valid: true,
        licenseKey: typeof obj.licenseKey === 'string' ? obj.licenseKey : request.licenseKey,
        discordUserId: typeof obj.discordUserId === 'string' ? obj.discordUserId : null,
      },
    } as R
  }

  if (obj.valid === false) {
    const reason = obj.reason
    if (typeof reason === 'string' && (expectedReasons as readonly string[]).includes(reason)) {
      return {
        kind: 'denied',
        response: { valid: false, reason: reason as F },
      } as R
    }
  }

  // Server contract drift (unknown reason, unexpected shape) — treat as
  // unreachable so the caller doesn't silently treat an unknown deny
  // reason as a success.
  return { kind: 'unreachable' } as R
}

/**
 * POST /v1/licenses/validate. Returns a `ValidateOutcome` that
 * collapses all failure modes (HTTP, network, JSON, server-denied) into
 * a single shape. The renderer side is the right place to keep this
 * normalization since the website's contract is small and stable.
 */
export function validateLicense(request: ValidateRequest): Promise<ValidateOutcome> {
  return postLicenseEndpoint<ValidateFailureReason, ValidateOutcome>(
    '/v1/licenses/validate',
    request,
    ['not_found', 'revoked', 'already_bound'],
  )
}

/**
 * POST /v1/licenses/redeem. Bind-on-first-use; behaviour matches
 * `validate`. Used on first install when the user pastes a freshly-
 * minted giveaway key.
 */
export function redeemLicense(request: ValidateRequest): Promise<RedeemOutcome> {
  return postLicenseEndpoint<RedeemFailureReason, RedeemOutcome>(
    '/v1/licenses/redeem',
    request,
    ['not_found', 'revoked', 'already_bound'],
  )
}

/**
 * Strip whitespace + dashes from a user-pasted key, uppercase it, and
 * return `{ raw, valid }`. `valid` is true iff the stripped input is
 * exactly 20 Crockford-base32 chars. The renderer uses this on submit
 * to decide whether to attempt a validate call.
 */
export function normalizeLicenseKey(input: string): {
  raw: string
  valid: boolean
} {
  const raw = input.replace(/[\s-]/g, '').toUpperCase()
  return { raw, valid: LICENSE_KEY_PATTERN.test(raw) }
}

/**
 * Format a normalized key with hyphen separators for display:
 * `XXXXXXXXXXXXXXXXXXXX` -> `XXXXX-XXXXX-XXXXX-XXXXX`. Returns the
 * input unchanged if it's not exactly 20 chars (e.g. while the user
 * is still typing).
 */
export function formatLicenseKey(normalized: string): string {
  if (normalized.length !== LICENSE_KEY_TOTAL_LEN) return normalized
  const groups: string[] = []
  for (let i = 0; i < LICENSE_KEY_GROUP_COUNT; i += 1) {
    groups.push(
      normalized.slice(
        i * LICENSE_KEY_GROUP_LEN,
        (i + 1) * LICENSE_KEY_GROUP_LEN,
      ),
    )
  }
  return groups.join('-')
}

/**
 * Auto-format a partially-typed key — strips anything that isn't
 * Crockford base32, uppercases, and re-hyphenates. Useful as an
 * `onChange` formatter so the input feels forgiving while the user
 * types.
 */
export function autoFormatLicenseKeyInput(input: string): string {
  const stripped = input
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/[^0123456789ABCDEFGHJKMNPQRSTVWXYZ]/g, '')
    .slice(0, LICENSE_KEY_TOTAL_LEN)
  return formatLicenseKey(stripped)
}

/**
 * Mask a formatted key for display in the bound-license card. Reveals
 * the first and last groups so users can confirm *which* key is bound,
 * but hides the middle two to discourage over-the-shoulder copying.
 *
 * `XXXXX-XXXXX-XXXXX-XXXXX` -> `XXXXX-XXXXX-•••••-•••••` (masked) but
 * keeping the structural hyphens readable.
 */
export function maskLicenseKey(formatted: string): string {
  const parts = formatted.split('-')
  if (parts.length !== LICENSE_KEY_GROUP_COUNT) return formatted
  return [parts[0], parts[1], '•••••', '•••••'].join('-')
}