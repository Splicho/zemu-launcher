//! Hardware-identity anchoring for the launcher's TPM/OS-UUID ladder.
//!
//! The launcher implements the per-device signal in the ban-evasion
//! plan — the hard-block counterpart of the web-side
//! FingerprintJS + IP soft signal. The TLS-only web handshake can't
//! prove "this is the same physical machine as before"; TPM EK
//! attestation (or an OS-UUID fallback for non-TPM devices) is what
//! gives the api an unspoofable device fingerprint.
//!
//! ## Discovery ladder
//!
//! We try anchors in priority order and **always** enroll exactly one:
//!
//! 1. `tpm-endorsed` — Windows-only. Reads the EK public key + identity
//!    key from Microsoft Platform Crypto Provider and signs a binding
//!    message with the identity key. Requires elevation because the EK
//!    can't be read from a non-elevated user. **Implemented as a
//!    best-effort ladder rung that returns `Err` when not elevated**;
//!    the elevated helper helper-binary ROTK pattern is documented as a
//!    follow-up. See `tpm.rs` and the inline TODOs.
//! 2. `tpm-identity` — TPM-level anchor without EK attestation. We
//!    create / open a TPM2 identity key inside the user's context and
//!    export the public part + a binding signature. **No elevation
//!    needed** (the TPM-as-a-Service API surfaces identity-key creation
//!    to non-elevated callers) — this is the strongest signal we ship
//!    today.
//! 3. `machine-guid` (Windows), `mac-ioplatform-uuid` (macOS),
//!    `linux-machine-id` (Linux) — last-resort registry / fs reads.
//!    Spoofable on its own (registry edit on Windows, kernel module on
//!    Linux) but combined with the api's per-user row, a fresh account
//!    on the same machine trips the gate.
//!
//! All errors are swallowed at the top level (see `compute_anchor`) —
//! a missing TPM row is `Ok(None)`, not `Err`. The launcher's auth flow
//! stays best-effort: no anchor, no enrollment, the user still signs
//! in; the api's `assertHardwareNotBanned` is a no-op pass when the
//! user has zero hardware rows.
//!
//! ## Hashing
//!
//! The api's `HardwareService.enroll` HMACs the `publicKey` server-side
//! (`hmacSha256Hex(parsed.publicKey)`) before insert so a leak of one
//! HMAC secret doesn't expose previously-rehashed rows. **We deliberately
//! do NOT pre-hash on the launcher side** — sending the raw pubkey /
//! UUID keeps the launcher independent of `HMAC_SECRET` (that key lives
//! only server-side). The api re-keys everything anyway.
//!
//! See `apps/api/src/hardware/launcher-spec.md` for the wire contract.
//!
//! ## Level-2 attestation (TODO, follow-up PR)
//!
//! ROTK's `electron/services/tpm-anchor.ts` goes a step further with
//! `TPM2_MakeCredential` / `TPM2_ActivateCredential`: the server
//! encrypts a nonce to the EK and the TPM decrypts it, proving the
//! signing key actually lives on a physical TPM (not a software
//! emulator). That requires a small elevated helper binary spawned via
//! UAC — same pattern as the launcher's auto-update helper. We'll add
//! `launcher-tpm-helper.exe` and the begin/complete ceremony when a
//! node-side TPM helper is available in the api.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::debug_log;
use crate::tpm;

/// Anchor kinds the api recognises. Mirrors
/// `apps/api/src/hardware/hardware.service.ts#enrollBodySchema`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum AnchorKind {
    /// Windows Platform Crypto Provider — EK + identity-key attestation.
    /// REQUIRES elevation; fails closed otherwise.
    TpmEndorsed,
    /// Level-1 anchor: TPM identity key, signed binding message.
    /// Available without elevation on Windows when the user has a TPM.
    TpmIdentity,
    /// `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`.
    MachineGuid,
    /// `IOPlatformUUID` from IOKit.
    MacIoplatformUuid,
    /// `/etc/machine-id` (UUID 128-bit, no newline).
    LinuxMachineId,
}

impl AnchorKind {
    pub fn api_string(self) -> &'static str {
        match self {
            AnchorKind::TpmEndorsed => "tpm-endorsed",
            AnchorKind::TpmIdentity => "tpm-identity",
            AnchorKind::MachineGuid => "machine-guid",
            AnchorKind::MacIoplatformUuid => "mac-ioplatform-uuid",
            AnchorKind::LinuxMachineId => "linux-machine-id",
        }
    }
}

/// The locally-computed device anchor. `pub_bytes` is the raw payload
/// the api re-keys server-side. For TPM kinds it's the serialized
/// identity-key public blob; for OS kinds it's the raw UUID string.
///
/// `metadata` is best-effort OS / TPM identification — manufacturer,
/// firmware version, etc. — that gets surfaced in the admin's per-user
/// hardware tab so an operator can tell at a glance "this is the same
/// laptop" without needing to decrypt anything.
#[derive(Debug, Clone)]
pub struct Anchor {
    pub kind: AnchorKind,
    pub pub_bytes: Vec<u8>,
    pub metadata: Value,
}

/// Wire shape returned from `enroll_hardware` to the renderer. The
/// api re-keys the raw `pub_bytes` server-side; we don't surface the
/// re-keyed hash to the renderer today (`hash` is reserved for a
/// future "my devices" UI), only the anchor kind so a future
/// component can render a meaningful label.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrolledAnchor {
    pub kind: String,
    pub hash: String,
}

/// Walk the discovery ladder and return the strongest available anchor.
///
/// Each rung is best-effort — a TPM failure that doesn't throw (e.g.
/// the EK can't be read because we're not elevated) falls through to
/// the next rung rather than surfacing an error. Returns `Ok(None)`
/// when nothing usable was found, which `enroll_hardware` translates
/// to a no-op (no row inserted, no `assertHardwareNotBanned` hit on
/// the next sign-in — best-effort per the plan).
pub fn compute_anchor(app: &tauri::AppHandle) -> Result<Option<Anchor>, String> {
    // 1. TPM-endorsed (level-2). Windows-only, elevation-gated. We try
    //    the elevated helper first; if the helper isn't bundled, or
    //    UAC was declined, fall through to the non-elevated identity
    //    key path. The helper binary is documented as a follow-up PR
    //    (see file-top module comment).
    #[cfg(target_os = "windows")]
    {
        if let Some(anchor) = try_tpm_endorsed_via_helper() {
            let _ = debug_log::append(
                app,
                "hardware",
                "compute_anchor: tpm-endorsed anchor found via elevated helper",
            );
            return Ok(Some(anchor));
        }
    }

    // 2. TPM identity key (level-1). The strongest signal we can ship
    //    without elevation: create-or-open a TPM2 identity key, export
    //    the public blob, sign a binding message so the api can later
    //    detect replays. No EK cert read — so a software emulator
    //    could technically pass this, but that's the level-2 problem.
    #[cfg(target_os = "windows")]
    {
        if let Some(anchor) = tpm::try_windows_identity_anchor(app) {
            let _ = debug_log::append(
                app,
                "hardware",
                "compute_anchor: tpm-identity anchor computed",
            );
            return Ok(Some(anchor));
        }
    }

    // 3. OS-UUID fallback. Always available on machines that have the
    //    registry / fs file; fails closed (returns Ok(None)) only on
    //    the most locked-down systems.
    if let Some(anchor) = try_os_uuid_anchor(app) {
        let _ = debug_log::append(
            app,
            "hardware",
            &format!(
                "compute_anchor: {kind} anchor computed",
                kind = anchor.kind.api_string()
            ),
        );
        return Ok(Some(anchor));
    }

    let _ = debug_log::append(
        app,
        "hardware",
        "compute_anchor: no usable anchor; launcher login proceeds without hardware ban-evasion defense",
    );
    Ok(None)
}

/// Read the OS-level hardware UUID. Split per-platform because the
/// shape and the failure modes are wildly different.
fn try_os_uuid_anchor(app: &tauri::AppHandle) -> Option<Anchor> {
    #[cfg(target_os = "windows")]
    {
        return read_machine_guid(app);
    }
    #[cfg(target_os = "macos")]
    {
        return read_mac_ioplatform_uuid(app);
    }
    #[cfg(target_os = "linux")]
    {
        return read_linux_machine_id(app);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = app;
        None
    }
}

#[cfg(target_os = "windows")]
fn read_machine_guid(app: &tauri::AppHandle) -> Option<Anchor> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let _ = app;
    // `HKLM` is readable without elevation; the only failure modes are
    // a missing key (an obscure locked-down sandbox) or a permission
    // deny on the most restricted Windows images. Both fall through
    // to `Ok(None)` so a missing MachineGuid never blocks login.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto_key = hklm
        .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        .ok()?;
    let value: String = crypto_key.get_value("MachineGuid").ok()?;
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }

    // The api accepts `publicKey: z.string().min(8).max(4096)`. A
    // Windows MachineGuid is `{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}`
    // (36 chars, well inside the limit). Emit the raw string as bytes
    // — the api will hash it server-side.
    Some(Anchor {
        kind: AnchorKind::MachineGuid,
        pub_bytes: trimmed.into_bytes(),
        metadata: serde_json::json!({
            "source": "HKLM\\SOFTWARE\\Microsoft\\Cryptography\\MachineGuid",
        }),
    })
}

#[cfg(target_os = "macos")]
fn read_mac_ioplatform_uuid(app: &tauri::AppHandle) -> Option<Anchor> {
    let _ = app;
    // `ioreg -rd1 -c IOPlatformExpertDevice` walks the IODeviceTree
    // plan and prints the `IOPlatformUUID` line. We're not on an iOS
    // sandbox (launcher is macOS desktop only); the syscall permission
    // is implicit for any user-process read of an IORegistry entry.
    //
    // We don't capture stderr separately — failures bubble up as
    // non-zero exit. The `-rd1 -c` combo is stable across macOS
    // releases, so a `Some(...)` here is reliable enough for a soft
    // signal.
    let output = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(rest) = line.trim_start().strip_prefix("\"IOPlatformUUID\" = \"") {
            let value = rest.trim_end_matches('"');
            if value.is_empty() {
                return None;
            }
            return Some(Anchor {
                kind: AnchorKind::MacIoplatformUuid,
                pub_bytes: value.to_string().into_bytes(),
                metadata: serde_json::json!({
                    "source": "ioreg -rd1 -c IOPlatformExpertDevice",
                }),
            });
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn read_linux_machine_id(app: &tauri::AppHandle) -> Option<Anchor> {
    let _ = app;
    // `/etc/machine-id` is a 128-bit UUID hex-encoded without dashes
    // (32 chars), terminated with a newline on most distros. Trimming
    // handles both shapes. The file is world-readable on every distro
    // I checked, but treat any error as a soft "no anchor" rather
    // than gating the launcher behind a sysfs permission check.
    let raw = std::fs::read_to_string("/etc/machine-id").ok()?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }
    Some(Anchor {
        kind: AnchorKind::LinuxMachineId,
        pub_bytes: trimmed.into_bytes(),
        metadata: serde_json::json!({
            "source": "/etc/machine-id",
        }),
    })
}

/// Level-2 (EK-attested) anchor. Currently a no-op stub: the elevation
/// helper binary that ROTK ships isn't bundled yet, so even on Windows
/// this falls through to the level-1 / OS-UUID anchor. The function
/// exists so the ladder reads top-to-bottom with a TODO annotation
/// pointing at the follow-up.
#[cfg(target_os = "windows")]
fn try_tpm_endorsed_via_helper() -> Option<Anchor> {
    // TODO(hardware): wire `launcher-tpm-helper.exe`. The helper:
    //   1. Exits early when its `parent_pid` is not the launcher's.
    //   2. Re-opens the launcher's process token via
    //      `OpenProcessToken` + `DuplicateTokenEx` and writes the EK
    //      public blob to a temp file the launcher reads back.
    //   3. UAC prompts once per machine (result is cached under
    //      `HKEY_CURRENT_USER\Software\ZEmu` until the EK rotates).
    //
    // We don't fail closed here — returning None forces the ladder to
    // fall through to `try_windows_identity_anchor`, which is still a
    // valid level-1 signal. The day we ship level-2, swap this for
    // an actual subprocess-spawn.
    None
}
