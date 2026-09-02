use crate::storage;
use anyhow::{Context, Result};
use rand::RngCore;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const PC_ID_FILE: &str = "pc-id.txt";

fn pc_id_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(storage::ensure_app_data_dir(app)?.join(PC_ID_FILE))
}

/// Return the persisted PC identifier, generating+persisting a new one if
/// none exists yet. The string is opaque to the renderer — it's just a
/// stable token the website's license validator uses to bind a key to
/// this machine. Using `rand` rather than hashing `hostname`/machine
/// props means the id survives hardware swaps (which we *want*: a user
/// who reformats their disk shouldn't lose their license).
///
/// Persisted under `app_data_dir/pc-id.txt` next to the launcher's other
/// state files. The file is a 32-byte hex string (64 chars). Not
/// encrypted — it's not a secret, just an identifier.
pub fn get_or_create_pc_identifier(app: &AppHandle) -> Result<String> {
    let path = pc_id_path(app)?;

    if let Ok(raw) = fs::read_to_string(&path) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let id = hex::encode(bytes);

    fs::write(&path, &id).with_context(|| format!("failed writing pc id to {}", path.display()))?;

    Ok(id)
}
