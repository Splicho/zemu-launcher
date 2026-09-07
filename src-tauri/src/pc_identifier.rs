//! PC identifier — derived from stable hardware identity so it survives
//! launcher uninstall/reinstall.
//!
//! The previous implementation minted a fresh random 32-byte token on
//! first launch and persisted it under `app_data_dir/pc-id.txt`. The
//! install directory gets wiped on uninstall, so reinstalls minted a
//! new token and the license endpoint legitimately reported the key
//! as bound to another machine.
//!
//! This module fixes that by deriving the identifier from platform-
//! specific hardware properties that live *outside* the install dir:
//!
//!   - **Windows**: SMBIOS System UUID (primary),
//!     `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` (secondary),
//!     `C:\` volume serial (tertiary).
//!   - **Linux**: `/sys/class/dmi/id/product_uuid` (best-effort, root-
//!     readable), `/var/lib/dbus/machine-id`, `/etc/machine-id`.
//!   - **macOS**: `IOPlatformUUID` via `ioreg`.
//!
//! Whatever the platform collects is concatenated in a stable order
//! and hashed with SHA-256. The digest is hex-encoded to a 64-char
//! string — the same wire shape the server already accepts, so the
//! `/v1/licenses/{validate,redeem}` contract is unchanged.
//!
//! The raw collected components (and the derived identifier) are
//! persisted to `hardware-ids.json` in `app_data_dir` for support
//! diagnostics. When a user reports an "already bound" error, support
//! can read that file to see exactly which identifiers the launcher
//! computed for the machine.
//!
//! Failures are best-effort. A VM with no SMBIOS, a sandbox with no
//! `/sys/class/dmi/id`, or a missing `MachineGuid` simply yields a
//! shorter hash input — the PC identifier still resolves to *some*
//! stable string for that machine, just composed of fewer signals.

use crate::debug_log;
use crate::storage::ensure_app_data_dir;
use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const HARDWARE_ID_REPORT_FILE: &str = "hardware-ids.json";

#[derive(Default, Serialize)]
struct HardwareComponents {
    smbios_system_uuid: Option<String>,
    machine_guid: Option<String>,
    volume_serial: Option<String>,
    dmi_product_uuid: Option<String>,
    machine_id: Option<String>,
    io_platform_uuid: Option<String>,
}

#[derive(Serialize)]
struct HardwareIdReport<'a> {
    platform: &'static str,
    pc_identifier: &'a str,
    components: &'a HardwareComponents,
}

/// Return the launcher's PC identifier. Derived from stable hardware
/// identity on each call (no caching layer — the work is cheap and a
/// cached value would only need invalidation on hardware swap, which
/// we want to *detect* via a recomputed hash anyway).
pub fn get_or_create_pc_identifier(app: &AppHandle) -> Result<String> {
    let components = collect_hardware_components();
    let pc_identifier = derive_pc_identifier(&components);

    if let Err(err) = write_hardware_id_report(app, &pc_identifier, &components) {
        let _ = debug_log::append(
            app,
            "pc_identifier",
            &format!("hardware id report write failed: {err}"),
        );
    }

    let _ = debug_log::append(
        app,
        "pc_identifier",
        &format!(
            "derived pc_identifier (smbios={} machine_guid={} volume_serial={} dmi_product_uuid={} machine_id={} io_platform_uuid={})",
            components.smbios_system_uuid.is_some(),
            components.machine_guid.is_some(),
            components.volume_serial.is_some(),
            components.dmi_product_uuid.is_some(),
            components.machine_id.is_some(),
            components.io_platform_uuid.is_some(),
        ),
    );

    Ok(pc_identifier)
}

fn derive_pc_identifier(components: &HardwareComponents) -> String {
    let mut hasher = Sha256::new();
    // Order is part of the contract: changing it changes the derived
    // identifier, which would invalidate every existing license
    // binding. Don't reorder these.
    for (label, value) in [
        ("smbios_system_uuid", components.smbios_system_uuid.as_deref()),
        ("machine_guid", components.machine_guid.as_deref()),
        ("volume_serial", components.volume_serial.as_deref()),
        ("dmi_product_uuid", components.dmi_product_uuid.as_deref()),
        ("machine_id", components.machine_id.as_deref()),
        ("io_platform_uuid", components.io_platform_uuid.as_deref()),
    ] {
        if let Some(value) = value {
            hasher.update(label.as_bytes());
            hasher.update([0u8]);
            hasher.update(value.as_bytes());
            hasher.update([0u8]);
        }
    }
    hex::encode(hasher.finalize())
}

fn hardware_id_report_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(ensure_app_data_dir(app)?.join(HARDWARE_ID_REPORT_FILE))
}

fn write_hardware_id_report(
    app: &AppHandle,
    pc_identifier: &str,
    components: &HardwareComponents,
) -> Result<()> {
    let report = HardwareIdReport {
        platform: std::env::consts::OS,
        pc_identifier,
        components,
    };
    let json = serde_json::to_string_pretty(&report)?;
    let path = hardware_id_report_path(app)?;
    fs::write(&path, json)
        .with_context(|| format!("failed writing hardware id report to {}", path.display()))?;
    Ok(())
}

fn collect_hardware_components() -> HardwareComponents {
    HardwareComponents {
        smbios_system_uuid: collect_smbios_system_uuid(),
        machine_guid: collect_machine_guid(),
        volume_serial: collect_system_volume_serial(),
        dmi_product_uuid: collect_dmi_product_uuid(),
        machine_id: collect_machine_id(),
        io_platform_uuid: collect_io_platform_uuid(),
    }
}

// No-op stubs so `collect_hardware_components` resolves on every
// target. The actual implementations are gated above.
#[cfg(not(target_os = "linux"))]
fn collect_dmi_product_uuid() -> Option<String> {
    None
}

#[cfg(not(target_os = "linux"))]
fn collect_machine_id() -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn collect_io_platform_uuid() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn collect_smbios_system_uuid() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn collect_machine_guid() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn collect_system_volume_serial() -> Option<String> {
    None
}

// =====================================================================
// Windows
// =====================================================================

#[cfg(windows)]
fn collect_smbios_system_uuid() -> Option<String> {
    use windows_sys::Win32::System::SystemInformation::GetSystemFirmwareTable;

    // 'RSMB' packed as little-endian u32 — the raw SMBIOS firmware
    // table provider signature (firmware table providers are
    // identified by a four-character ASCII code in their DWORD).
    const RSMB_SIGNATURE: u32 = 0x52534D42;

    // First call: probe the required buffer size.
    let buffer_size = unsafe {
        GetSystemFirmwareTable(RSMB_SIGNATURE, 0, std::ptr::null_mut(), 0)
    };
    if buffer_size == 0 || buffer_size > 65_536 {
        return None;
    }

    let mut buffer = vec![0u8; buffer_size as usize];
    let written = unsafe {
        GetSystemFirmwareTable(
            RSMB_SIGNATURE,
            0,
            buffer.as_mut_ptr() as *mut _,
            buffer_size,
        )
    };
    if written == 0 || written > buffer_size {
        return None;
    }
    buffer.truncate(written as usize);

    parse_smbios_system_uuid(&buffer)
}

/// Walk the SMBIOS structure table looking for a Type 1 (System
/// Information) record and return its UUID as a canonical
/// `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX` string.
///
/// SMBIOS comes in two flavours on the wire today:
///   - The v2.x entry point anchors with `_SM_` and the structure
///     table is referenced by a 16-bit length + 32-bit address at
///     offsets 0x16 / 0x18.
///   - The v3.x entry point anchors with `_SM3_` and uses a 32-bit
///     length + 64-bit address at offsets 0x0C / 0x10.
///
/// Either way the table is a sequence of typed records. Each record
/// is a 4-byte header (type, length, handle-hi, handle-lo), then a
/// fixed-format body, then a null-terminated string table. A type
/// value of 127 marks the end-of-table sentinel.
#[cfg(windows)]
fn parse_smbios_system_uuid(buf: &[u8]) -> Option<String> {
    let (table_start, table_len) = locate_smbios_table(buf)?;

    let mut offset = 0usize;
    while offset + 4 <= table_len {
        let rec_type = buf[table_start + offset];
        if rec_type == 127 {
            return None;
        }
        let rec_length = buf[table_start + offset + 1] as usize;
        if rec_length < 4 || offset.saturating_add(rec_length) > table_len {
            return None;
        }

        if rec_type == 1 && rec_length >= 0x19 {
            // System Information record: UUID sits at offset 0x08
            // from the record start (16 bytes, mixed-endian — first
            // three fields little-endian, last 8 bytes big-endian).
            let uuid_bytes = &buf[table_start + offset + 0x08..table_start + offset + 0x18];
            return Some(format_smbios_uuid(uuid_bytes));
        }

        // Skip past this record's unformatted-string area (terminated
        // by a double-null byte pair) to reach the next record.
        let mut cursor = offset + rec_length;
        while cursor + 1 < table_len {
            if buf[table_start + cursor] == 0 && buf[table_start + cursor + 1] == 0 {
                cursor += 2;
                break;
            }
            cursor += 1;
        }
        offset = cursor;
    }
    None
}

#[cfg(windows)]
fn locate_smbios_table(buf: &[u8]) -> Option<(usize, usize)> {
    if buf.len() >= 0x1F && &buf[0..4] == b"_SM_" {
        let len = u16::from_le_bytes([buf[0x16], buf[0x17]]) as usize;
        let addr = u32::from_le_bytes([buf[0x18], buf[0x19], buf[0x1A], buf[0x1B]])
            as usize;
        if len != 0 && addr.checked_add(len).map_or(false, |end| end <= buf.len()) {
            return Some((addr, len));
        }
    }
    if buf.len() >= 0x18 + 8 && &buf[0..5] == b"_SM3_" {
        let len = u32::from_le_bytes([buf[0x0C], buf[0x0D], buf[0x0E], buf[0x0F]]) as usize;
        let addr = u64::from_le_bytes([
            buf[0x10], buf[0x11], buf[0x12], buf[0x13],
            buf[0x14], buf[0x15], buf[0x16], buf[0x17],
        ]) as usize;
        if len != 0 && addr.checked_add(len).map_or(false, |end| end <= buf.len()) {
            return Some((addr, len));
        }
    }
    None
}

#[cfg(windows)]
fn format_smbios_uuid(bytes: &[u8]) -> String {
    if bytes.len() < 16 {
        return String::new();
    }
    format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        bytes[3], bytes[2], bytes[1], bytes[0],
        bytes[5], bytes[4],
        bytes[7], bytes[6],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

#[cfg(windows)]
fn collect_machine_guid() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;

    let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .ok()?;
    let guid: String = key.get_value("MachineGuid").ok()?;
    let trimmed = guid.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(windows)]
fn collect_system_volume_serial() -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW;

    let root: Vec<u16> = "C:\\\0".encode_utf16().collect();
    let mut serial: u32 = 0;
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            &mut serial,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 || serial == 0 {
        return None;
    }
    Some(format!("{:08X}", serial))
}

// =====================================================================
// Linux
// =====================================================================

#[cfg(target_os = "linux")]
fn collect_dmi_product_uuid() -> Option<String> {
    read_trimmed_nonempty("/sys/class/dmi/id/product_uuid")
}

#[cfg(target_os = "linux")]
fn collect_machine_id() -> Option<String> {
    // dbus installs first, systemd's /etc/machine-id is the fallback.
    read_trimmed_nonempty("/var/lib/dbus/machine-id")
        .or_else(|| read_trimmed_nonempty("/etc/machine-id"))
}

#[cfg(target_os = "linux")]
fn read_trimmed_nonempty(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "0")
}

// =====================================================================
// macOS
// =====================================================================

#[cfg(target_os = "macos")]
fn collect_io_platform_uuid() -> Option<String> {
    use std::process::Command;

    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim_start();
        let after_key = trimmed.strip_prefix("\"IOPlatformUUID\"")?;
        let after_eq = after_key.trim_start().strip_prefix('=')?.trim_start();
        let value = after_eq.strip_prefix('"').and_then(|s| s.strip_suffix('"'))?;
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}
