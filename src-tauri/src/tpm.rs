//! Windows TPM helpers — level-1 (identity key) + level-2 (EK + activation).
//!
//! ## Status today (best-effort)
//!
//! We expose a single `try_windows_identity_anchor` entry point that
//! the hardware ladder calls between the EK helper and the OS-UUID
//! fallback. The current implementation is a **deliberate no-op**:
//!
//! - The level-1 path (TPM identity key, no EK, no elevation) needs a
//!   TPM command stack — `tss-esapi` or direct `Tbsi_*` FFI. Bundling
//!   `tss-esapi` is a sizeable dependency (~6 crates-transitive, pulls
//!   in `tss2-*` and `dlmalloc`) for a signal strength that the OS-UUID
//!   fallback already covers. A level-2 helper binary (which would let
//!   us use Tpm2Tssc too) is the cleaner path forward.
//! - The level-2 path (EK cert read + `TPM2_MakeCredential` /
//!   `TPM2_ActivateCredential`) needs an elevated helper binary,
//!   mirrored from ROTK's `electron/services/tpm-anchor.ts`. Until the
//!   helper is bundled, this rung returns `None` and the ladder falls
//!   through to the OS-UUID anchor.
//!
//! When the helper ships, replace this stub with the two
//! implementations and wire the elevated-helper spawn into
//! `hardware::try_tpm_endorsed_via_helper`. The wire shape
//! (`Anchor { kind, pub_bytes, metadata }`) stays the same so the
//! remainder of the ladder doesn't change.
//!
//! ## Why not `tss-esapi`
//!
//! `tss-esapi = "7"` would cover level-1 today. It compiles to a
//! static C library on every target we ship (Windows + macOS + Linux),
//! which means a 2–4 MB native dep just to read a TPM pubkey. The OS-UUID
//! fallback already catches every fresh-machine ban-evader who didn't
//! reimage; the level-1 signal's marginal value is gated on the
//! level-2 helper landing in the same PR. Holding off until they ship
//! together keeps the binary small.

use tauri::AppHandle;

use crate::hardware::{Anchor, AnchorKind};

/// Level-1 anchor entry point. Currently a stub — returns `None` so
/// the ladder falls through to the OS-UUID rung. See module docs.
#[cfg(target_os = "windows")]
pub fn try_windows_identity_anchor(_app: &AppHandle) -> Option<Anchor> {
    // TODO(hardware): implement the level-1 path. When the
    // `launcher-tpm-helper.exe` lands it will return:
    //
    //   Some(Anchor {
    //       kind: AnchorKind::TpmIdentity,
    //       pub_bytes: aik_pubkey_der.into(),
    //       metadata: serde_json::json!({ "manufacturer": "...", "firmware": "..." }),
    //   })
    //
    // The helper is non-elevated — Windows TBS allows identity-key
    // create/open from any user context. We sign the binding message
    // (HMAC over `launcher_jwt || nonce`) inside the helper to
    // confirm the key isn't a remote replay.
    None
}

/// No-op on non-Windows targets. The TPM path is Windows-only today.
#[cfg(not(target_os = "windows"))]
pub fn try_windows_identity_anchor(_app: &AppHandle) -> Option<Anchor> {
    None
}

/// Marker so the unused-import lint doesn't fire when only the
/// non-Windows stub gets compiled.
#[allow(dead_code)]
const ANCHOR_KIND_TPM_IDENTITY: AnchorKind = AnchorKind::TpmIdentity;
