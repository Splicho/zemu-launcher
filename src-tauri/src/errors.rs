//! User-actionable error codes for Steam / depot failures.
//!
//! ## Why this module exists
//!
//! The wizard used to receive raw `anyhow` chains through the
//! `steam-error` / `depot-error` events, e.g.:
//!
//! ```text
//! fetching depot decryption key: depot access denied: depot 433851
//! ```
//!
//! Two problems with that:
//!
//! 1. It reads like a stack trace, not like something a player can act
//!    on. "depot access denied" doesn't tell them the account they
//!    scanned is not the one that owns H1Z1, and it certainly doesn't
//!    suggest signing in with another account.
//! 2. The text is lossy. [`steamroom`]'s `CMsgClientGetDepotDecryptionKey`
//!    response handler maps **every** non-OK `EResult` to
//!    `ConnectionError::DepotAccessDenied(depot_id)` — so `EResult::Fail
//!    (2)`, `Busy (10)`, `Timeout (16)`, `RateLimitExceeded (84)` and
//!    `AccessDenied (15)` all render identically. The code is thrown
//!    away before we ever see it.
//!
//! This module turns the raw chain into a small, stable [`ErrorCode`]
//! vocabulary the renderer can localize, plus the English fallback and
//! the untouched technical detail for the "Technical details" drawer and
//! the debug log. The UI never has to parse prose again.
//!
//! ## Classification strategy
//!
//! We walk `anyhow::Error::chain()` looking for concrete error types
//! (`steamroom::Error`, `steamroom_client::login::LoginError`,
//! `std::io::Error`) so the common cases classify structurally. Only
//! when a type has already been flattened into a string — the download
//! pipeline returns a `rootcause::Report` that we stringify — do we fall
//! back to matching known substrings. Keep the message patterns narrow
//! and append-only; they are a safety net, not the primary mechanism.
//!
//! ## Adding a code
//!
//! 1. Add the variant + `as_str` / `retryable` / `fallback_message`
//!    arms below.
//! 2. Return it from one of the `classify_*` functions.
//! 3. Add `errors.<code>.title` / `.description` to all four locale
//!    files (en, fr, pt-BR, zh). Unknown codes fall back to the raw
//!    English message, so a missing translation is degraded, not broken.

use serde::Serialize;
use steamroom::enums::EResultError;
use steamroom::error::{ConnectionError, Error as SteamError};
use steamroom_client::login::LoginError;

/// Stable, machine-readable failure categories.
///
/// Serialized as `snake_case` strings on the wire (`"steam_depot_not_owned"`).
/// These strings are part of the renderer contract: support can ask a
/// user for the code shown in the error card, and the answer maps back
/// to exactly one cause.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// Steam refused the depot decryption key. In practice: the signed-in
    /// account does not hold a licence covering app 433850 / depot 433851
    /// (wrong account, never claimed the free game, Family Sharing, …).
    SteamDepotNotOwned,
    /// No refresh token in the keychain — the QR gate was never completed.
    SteamNotSignedIn,
    /// The stored refresh token is no longer valid; a new QR scan is needed.
    SteamSessionExpired,
    /// Steam rejected the logon for a reason that isn't a stale token
    /// (banned, guard code, unknown EResult, …).
    SteamLoginFailed,
    /// Token present but the account name wasn't persisted alongside it.
    SteamAccountMissing,
    /// Transient Steam-side unavailability (busy / timeout / no CM).
    SteamBusy,
    /// Steam is throttling us (`EResult::{LimitExceeded,RateLimitExceeded}`).
    SteamRateLimited,
    /// Could not reach Steam at all (DNS, TCP, TLS, CM disconnect).
    SteamNetwork,
    /// The CDN rejected chunk/manifest requests with 401/403.
    SteamCdnAuth,
    /// Steam no longer serves the pinned H1Z1 manifest / request code.
    SteamManifestUnavailable,
    /// The install drive is out of space.
    DiskFull,
    /// The install folder (or a file in it) isn't writable.
    DiskPermission,
    /// Any other filesystem write failure.
    DiskError,
    /// OS keychain read/write failure.
    Keychain,
    /// Unclassified — `message` / `detail` carry the raw text.
    Unknown,
}

impl ErrorCode {
    /// Wire representation. Must stay in sync with `KNOWN_ERROR_CODES` in
    /// `src/lib/app-errors.ts`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SteamDepotNotOwned => "steam_depot_not_owned",
            Self::SteamNotSignedIn => "steam_not_signed_in",
            Self::SteamSessionExpired => "steam_session_expired",
            Self::SteamLoginFailed => "steam_login_failed",
            Self::SteamAccountMissing => "steam_account_missing",
            Self::SteamBusy => "steam_busy",
            Self::SteamRateLimited => "steam_rate_limited",
            Self::SteamNetwork => "steam_network",
            Self::SteamCdnAuth => "steam_cdn_auth",
            Self::SteamManifestUnavailable => "steam_manifest_unavailable",
            Self::DiskFull => "disk_full",
            Self::DiskPermission => "disk_permission",
            Self::DiskError => "disk_error",
            Self::Keychain => "keychain_error",
            Self::Unknown => "unknown",
        }
    }

    /// Whether repeating the exact same operation could plausibly succeed
    /// without the user changing anything. Drives the UI's "Retry" CTA.
    pub const fn retryable(self) -> bool {
        matches!(
            self,
            Self::SteamBusy
                | Self::SteamRateLimited
                | Self::SteamNetwork
                | Self::SteamCdnAuth
                | Self::SteamManifestUnavailable
                | Self::Unknown
        )
    }

    /// English one-liner. The renderer prefers `errors.<code>` from the
    /// locale files; this is the fallback for missing translations, the
    /// debug log, and non-i18n surfaces (toasts, terminal output).
    const fn fallback_message(self) -> &'static str {
        match self {
            Self::SteamDepotNotOwned => {
                "Your Steam account doesn't own H1Z1: King of the Kill."
            }
            Self::SteamNotSignedIn => "Sign in with Steam to download the game.",
            Self::SteamSessionExpired => "Your Steam sign-in expired. Sign in again.",
            Self::SteamLoginFailed => "Steam rejected the sign-in.",
            Self::SteamAccountMissing => {
                "The saved Steam account details are incomplete. Sign in again."
            }
            Self::SteamBusy => "Steam is busy right now. Try again in a moment.",
            Self::SteamRateLimited => {
                "Steam is rate-limiting download requests. Wait a minute, then try again."
            }
            Self::SteamNetwork => {
                "Could not reach Steam. Check your internet connection and try again."
            }
            Self::SteamCdnAuth => {
                "Steam's download server rejected the request. Start the download again."
            }
            Self::SteamManifestUnavailable => {
                "Steam is no longer serving this H1Z1 build."
            }
            Self::DiskFull => "Not enough free disk space in the install folder.",
            Self::DiskPermission => {
                "The install folder is not writable. Choose a different folder."
            }
            Self::DiskError => "Writing the game files to disk failed.",
            Self::Keychain => {
                "The launcher could not access the system keychain to save your Steam login."
            }
            Self::Unknown => "The Steam download failed.",
        }
    }
}

/// The payload emitted on `steam-error` / `depot-error` and returned by
/// `steam_install_depot`. Field names are camelCase on the wire.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    /// Stable code, see [`ErrorCode`].
    pub code: &'static str,
    /// English fallback copy.
    pub message: &'static str,
    /// Full technical chain, for the log and the collapsible detail box.
    pub detail: String,
    /// Whether a bare retry can help.
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code: code.as_str(),
            message: code.fallback_message(),
            detail: detail.into(),
            retryable: code.retryable(),
        }
    }

    /// Classify an `anyhow` chain. Never fails — unclassified errors come
    /// back as [`ErrorCode::Unknown`] with the original text intact.
    pub fn from_anyhow(err: &anyhow::Error) -> Self {
        let detail = format!("{err:#}");
        match classify_chain(err) {
            Some(code) => Self::new(code, detail),
            None => Self::new(ErrorCode::Unknown, detail),
        }
    }

    /// One-line form for `debug_log`: `code=<code>retryable=<bool> detail=…`.
    pub fn log_line(&self) -> String {
        format!(
            "code={} retryable={} detail={}",
            self.code, self.retryable, self.detail
        )
    }
}

fn classify_chain(err: &anyhow::Error) -> Option<ErrorCode> {
    for cause in err.chain() {
        if let Some(steam) = cause.downcast_ref::<SteamError>() {
            if let Some(code) = classify_steam_error(steam) {
                return Some(code);
            }
        }
        if let Some(login) = cause.downcast_ref::<LoginError>() {
            if let Some(code) = classify_login_error(login) {
                return Some(code);
            }
        }
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            return Some(classify_io_error(io));
        }
    }
    classify_message(&format!("{err:#}"))
}

fn classify_steam_error(err: &SteamError) -> Option<ErrorCode> {
    match err {
        SteamError::Connection(conn) => match conn {
            // The big one: steamroom collapses every non-OK EResult from
            // the depot-key response into this variant. "Not owned" is by
            // far the most common real cause, and the localized copy
            // mentions the transient alternative.
            ConnectionError::DepotAccessDenied(_) => Some(ErrorCode::SteamDepotNotOwned),
            ConnectionError::LogonFailed(result) => Some(classify_logon_result(*result)),
            ConnectionError::ServiceMethodFailed(result) => Some(classify_service_result(*result)),
            ConnectionError::DnsResolutionFailed | ConnectionError::Disconnected => {
                Some(ErrorCode::SteamNetwork)
            }
            ConnectionError::Io(io) => Some(classify_io_error(io)),
            _ => None,
        },
        SteamError::CdnStatus { status, .. } => Some(classify_http_status(status.as_u16())),
        // Every `reqwest` failure here is a transport problem (timeout,
        // refused connection, TLS, body read).
        SteamError::Http(_) => Some(ErrorCode::SteamNetwork),
        SteamError::Io(io) => Some(classify_io_error(io)),
        _ => None,
    }
}

fn classify_login_error(err: &LoginError) -> Option<ErrorCode> {
    match err {
        LoginError::InvalidPassword => Some(ErrorCode::SteamSessionExpired),
        LoginError::InvalidGuardCode => Some(ErrorCode::SteamLoginFailed),
        LoginError::LogonFailed(result) => Some(classify_logon_result(*result)),
        LoginError::Transport(inner) => classify_steam_error(inner),
        LoginError::NoCmServers => Some(ErrorCode::SteamNetwork),
        _ => None,
    }
}

fn classify_logon_result(result: EResultError) -> ErrorCode {
    match result {
        EResultError::InvalidPassword
        | EResultError::AccessDenied
        | EResultError::LoggedInElsewhere
        | EResultError::Revoked
        | EResultError::Expired => ErrorCode::SteamSessionExpired,
        EResultError::RateLimitExceeded
        | EResultError::LimitExceeded
        | EResultError::LoginDeniedThrottle => ErrorCode::SteamRateLimited,
        EResultError::Busy
        | EResultError::Timeout
        | EResultError::NoConnection
        | EResultError::ServiceUnavailable => ErrorCode::SteamBusy,
        _ => ErrorCode::SteamLoginFailed,
    }
}

fn classify_service_result(result: EResultError) -> ErrorCode {
    match result {
        EResultError::RateLimitExceeded
        | EResultError::LimitExceeded
        | EResultError::LoginDeniedThrottle => ErrorCode::SteamRateLimited,
        EResultError::Busy
        | EResultError::Timeout
        | EResultError::NoConnection
        | EResultError::ServiceUnavailable => ErrorCode::SteamBusy,
        _ => ErrorCode::SteamLoginFailed,
    }
}

fn classify_http_status(status: u16) -> ErrorCode {
    match status {
        401 | 403 => ErrorCode::SteamCdnAuth,
        429 => ErrorCode::SteamRateLimited,
        500..=599 => ErrorCode::SteamBusy,
        _ => ErrorCode::SteamCdnAuth,
    }
}

fn classify_io_error(err: &std::io::Error) -> ErrorCode {
    // `ErrorKind::{StorageFull,QuotaExceeded}` are still unstable on our
    // MSRV, so check the platform error codes directly:
    //   - 28  ENOSPC          (Linux/macOS)
    //   - 112 ERROR_DISK_FULL  (Windows)
    //   - 39  ERROR_HANDLE_DISK_FULL (Windows)
    if matches!(err.raw_os_error(), Some(28) | Some(112) | Some(39)) {
        return ErrorCode::DiskFull;
    }
    match err.kind() {
        std::io::ErrorKind::PermissionDenied => ErrorCode::DiskPermission,
        // Socket-level IO errors also surface as `io::Error` (the CM
        // transport wraps them). Reporting those as "writing the game
        // files failed" would send users chasing a disk problem that
        // doesn't exist, so map the connection-ish kinds to the network
        // code instead.
        std::io::ErrorKind::ConnectionReset
        | std::io::ErrorKind::ConnectionAborted
        | std::io::ErrorKind::ConnectionRefused
        | std::io::ErrorKind::NotConnected
        | std::io::ErrorKind::TimedOut
        | std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::UnexpectedEof => ErrorCode::SteamNetwork,
        _ => ErrorCode::DiskError,
    }
}

/// Last-resort classification for errors that lost their concrete type
/// (the download pipeline stringifies its `rootcause::Report`, and a few
/// of our own contexts are plain `anyhow!` strings). Patterns are matched
/// case-insensitively; keep them specific enough to avoid false hits.
fn classify_message(message: &str) -> Option<ErrorCode> {
    let text = message.to_ascii_lowercase();

    // Manifest first: a 401 while fetching the manifest means the pinned
    // 2017 build is gone, which is a different fix ("use the manual
    // instructions") than a chunk-level auth failure.
    if text.contains("manifest request code") {
        return Some(ErrorCode::SteamManifestUnavailable);
    }
    if text.contains("downloading manifest") && (text.contains("401") || text.contains("403")) {
        return Some(ErrorCode::SteamManifestUnavailable);
    }
    if text.contains("http 401") || text.contains("http 403") {
        return Some(ErrorCode::SteamCdnAuth);
    }
    if text.contains("http 429") || text.contains("too many requests") {
        return Some(ErrorCode::SteamRateLimited);
    }
    if text.contains("no space left") || text.contains("disk full") || text.contains("os error 112")
    {
        return Some(ErrorCode::DiskFull);
    }
    if text.contains("permission denied") || text.contains("access is denied") {
        return Some(ErrorCode::DiskPermission);
    }
    if text.contains("depot access denied") {
        return Some(ErrorCode::SteamDepotNotOwned);
    }
    if text.contains("not signed in") {
        return Some(ErrorCode::SteamNotSignedIn);
    }
    if text.contains("no account name stored") {
        return Some(ErrorCode::SteamAccountMissing);
    }
    if text.contains("keychain") || text.contains("keyring") {
        return Some(ErrorCode::Keychain);
    }
    if text.contains("dns resolution failed")
        || text.contains("connection refused")
        || text.contains("connection reset")
        || text.contains("timed out")
        || text.contains("disconnected")
    {
        return Some(ErrorCode::SteamNetwork);
    }
    if text.contains("logon failed") || text.contains("logon rejected") {
        return Some(ErrorCode::SteamLoginFailed);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(err: anyhow::Error) -> AppError {
        AppError::from_anyhow(&err)
    }

    /// The exact failure from the onboarding report: a denied depot key.
    /// It must come out as an actionable "doesn't own the game" code with
    /// the original Steam text preserved in `detail`.
    #[test]
    fn depot_access_denied_is_not_owned() {
        let inner = SteamError::Connection(ConnectionError::DepotAccessDenied(433_851));
        let err = anyhow::Error::new(inner).context("fetching depot decryption key");
        let app = classify(err);

        assert_eq!(app.code, "steam_depot_not_owned");
        assert!(!app.retryable);
        assert!(app.message.contains("doesn't own"));
        assert!(
            app.detail.contains("depot access denied: depot 433851"),
            "detail must keep the raw Steam text: {}",
            app.detail
        );
    }

    #[test]
    fn missing_token_is_not_signed_in() {
        let err = anyhow::anyhow!("not signed in; run the QR gate first");
        let app = classify(err);
        assert_eq!(app.code, "steam_not_signed_in");
        assert!(!app.retryable);
    }

    #[test]
    fn missing_account_name_is_account_missing() {
        let err = anyhow::anyhow!(
            "no account name stored alongside the refresh token; sign in once with the QR flow"
        );
        assert_eq!(classify(err).code, "steam_account_missing");
    }

    #[test]
    fn invalid_password_login_is_session_expired() {
        let err = anyhow::Error::new(LoginError::InvalidPassword).context("opening CM session");
        let app = classify(err);
        assert_eq!(app.code, "steam_session_expired");
        assert!(!app.retryable);
    }

    #[test]
    fn dns_transport_is_network() {
        let inner = SteamError::Connection(ConnectionError::DnsResolutionFailed);
        let err = anyhow::Error::new(LoginError::Transport(inner)).context("connecting to Steam");
        let app = classify(err);
        assert_eq!(app.code, "steam_network");
        assert!(app.retryable);
    }

    #[test]
    fn rate_limited_logon_is_rate_limited() {
        let err = anyhow::Error::new(LoginError::LogonFailed(EResultError::RateLimitExceeded));
        assert_eq!(classify(err).code, "steam_rate_limited");
    }

    #[test]
    fn busy_logon_is_busy_and_retryable() {
        let err = anyhow::Error::new(LoginError::LogonFailed(EResultError::Busy));
        let app = classify(err);
        assert_eq!(app.code, "steam_busy");
        assert!(app.retryable);
    }

    #[test]
    fn banned_logon_is_login_failed() {
        let err = anyhow::Error::new(LoginError::LogonFailed(EResultError::Banned));
        assert_eq!(classify(err).code, "steam_login_failed");
    }

    #[test]
    fn cdn_403_is_cdn_auth() {
        let err = anyhow::anyhow!("depot download failed: CDN returned HTTP 403");
        let app = classify(err);
        assert_eq!(app.code, "steam_cdn_auth");
        assert!(app.retryable);
    }

    #[test]
    fn manifest_401_is_manifest_unavailable() {
        let err = anyhow::anyhow!(
            "downloading manifest from CDN: CDN returned HTTP 401"
        );
        assert_eq!(classify(err).code, "steam_manifest_unavailable");
    }

    #[test]
    fn disk_full_is_detected_from_message() {
        let err = anyhow::anyhow!("writing ClientConfig.ini: No space left on device");
        assert_eq!(classify(err).code, "disk_full");
    }

    #[test]
    fn disk_permission_is_detected_from_io_kind() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let err = anyhow::Error::new(io).context("creating install folder");
        let app = classify(err);
        assert_eq!(app.code, "disk_permission");
        assert!(!app.retryable);
    }

    #[test]
    fn keychain_write_failure_is_keychain() {
        let err = anyhow::anyhow!("writing refresh token to OS keychain: platform error");
        assert_eq!(classify(err).code, "keychain_error");
    }

    #[test]
    fn socket_io_error_is_network_not_disk() {
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionReset, "reset");
        let err = anyhow::Error::new(io).context("reading CM packet");
        assert_eq!(classify(err).code, "steam_network");
    }

    /// The event payload is the contract with `src/lib/app-errors.ts`:
    /// camelCase field names, `retryable` as a real bool.
    #[test]
    fn payload_serializes_with_camel_case_fields() {
        let app = AppError::new(ErrorCode::SteamDepotNotOwned, "detail text");
        let json = serde_json::to_value(&app).expect("serialize");
        assert_eq!(json["code"], "steam_depot_not_owned");
        assert_eq!(
            json["message"],
            "Your Steam account doesn't own H1Z1: King of the Kill."
        );
        assert_eq!(json["detail"], "detail text");
        assert_eq!(json["retryable"], false);
    }

    #[test]
    fn unclassified_error_stays_unknown_with_detail() {
        let err = anyhow::anyhow!("something nobody has seen before");
        let app = classify(err);
        assert_eq!(app.code, "unknown");
        assert!(app.retryable);
        assert!(app.detail.contains("something nobody has seen before"));
    }

    /// Codes are part of the wire contract with `app-errors.ts`; changing
    /// one silently breaks the localized copy, so pin them here.
    #[test]
    fn wire_codes_are_stable() {
        let codes = [
            (ErrorCode::SteamDepotNotOwned, "steam_depot_not_owned"),
            (ErrorCode::SteamNotSignedIn, "steam_not_signed_in"),
            (ErrorCode::SteamSessionExpired, "steam_session_expired"),
            (ErrorCode::SteamLoginFailed, "steam_login_failed"),
            (ErrorCode::SteamAccountMissing, "steam_account_missing"),
            (ErrorCode::SteamBusy, "steam_busy"),
            (ErrorCode::SteamRateLimited, "steam_rate_limited"),
            (ErrorCode::SteamNetwork, "steam_network"),
            (ErrorCode::SteamCdnAuth, "steam_cdn_auth"),
            (ErrorCode::SteamManifestUnavailable, "steam_manifest_unavailable"),
            (ErrorCode::DiskFull, "disk_full"),
            (ErrorCode::DiskPermission, "disk_permission"),
            (ErrorCode::DiskError, "disk_error"),
            (ErrorCode::Keychain, "keychain_error"),
            (ErrorCode::Unknown, "unknown"),
        ];
        for (code, wire) in codes {
            assert_eq!(code.as_str(), wire);
        }
    }

    #[test]
    fn log_line_includes_code_and_detail() {
        let app = AppError::new(ErrorCode::SteamBusy, "steam said busy");
        let line = app.log_line();
        assert!(line.contains("code=steam_busy"));
        assert!(line.contains("detail=steam said busy"));
    }
}
