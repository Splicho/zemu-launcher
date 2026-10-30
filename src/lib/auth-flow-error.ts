/**
 * Structured auth failure used by the launcher's login surfaces.
 *
 * The server returns a machine-readable `error` code (`user_banned`,
 * `session_missing`, …) and, for a ban, the reason + expiry alongside
 * it. `Error#message` stays the code so the existing i18n mapping in
 * `lib/auth-errors.ts` keeps working; `banDetails` carries the extra
 * two fields so the login banner can say *why* and *until when*.
 */
export type BanDetails = {
  /** Moderator's reason, or null when the ban was filed without one. */
  reason: string | null
  /** ISO 8601 expiry, or null for a permanent ban. */
  expiresAt: string | null
}

export class AuthFlowError extends Error {
  readonly banDetails: BanDetails | null

  constructor(message: string, banDetails: BanDetails | null = null) {
    super(message)
    this.name = 'AuthFlowError'
    this.banDetails = banDetails
  }
}
