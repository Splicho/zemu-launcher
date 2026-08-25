//! Manifest + chunk download using `steamroom-client`'s `DepotJob`.
//!
//! Pipeline:
//!   1. `get_depot_decryption_key` (CM protocol)
//!   2. `get_manifest_request_code` (CM protocol, may be 0 for old depots)
//!   3. `get_cdn_servers` (CM protocol)
//!   4. `get_cdn_auth_token` (CM protocol, optional)
//!   5. Download + decompress the manifest from the CDN
//!   6. Parse + decrypt filenames (if `filenames_encrypted`)
//!   7. Spawn `DepotJob` with a `CdnChunkFetcher`
//!   8. Forward `DownloadEvent`s through the progress bridge

use crate::debug_log;
use crate::steam::progress::{spawn_event_bridge, ProgressCounters};
use crate::steam::DepotRequest;
use anyhow::{anyhow, Result};
use std::sync::Arc;
use steamroom::cdn::CdnClient;
use steamroom::cdn::CdnServerPool;
use steamroom::client::LoggedIn;
use steamroom::client::SteamClient;
use steamroom::depot::manifest::DepotManifest;
use steamroom::depot::{AppId, CellId, DepotId, ManifestId};
use steamroom_client::download::{CdnChunkFetcher, DepotJob};
use tauri::AppHandle;
use tokio::sync::mpsc::unbounded_channel;

pub async fn download_and_assemble(
    app: &AppHandle,
    client: &SteamClient<LoggedIn>,
    request: &DepotRequest,
) -> Result<()> {
    let _ = debug_log::append(
        app,
        "steam.download",
        &format!(
            "download_and_assemble app={} depot={} manifest={}",
            request.app_id, request.depot_id, request.manifest_id
        ),
    );

    let app_id = AppId(request.app_id);
    let depot_id = DepotId(request.depot_id);
    let manifest_id = ManifestId(request.manifest_id);

    // 1. Depot decryption key
    let depot_key = client
        .get_depot_decryption_key(depot_id, app_id)
        .await
        .map_err(|err| anyhow!("depot decryption key: {err}"))?;

    // 2. Manifest request code (may be 0 for older depots)
    let request_code = match client
        .get_manifest_request_code(app_id, depot_id, manifest_id, Some("public"), None)
        .await
    {
        Ok(Some(code)) => code,
        Ok(None) => 0,
        Err(err) => {
            let _ = debug_log::append(
                app,
                "steam.download",
                &format!("manifest request code error: {err}; using 0"),
            );
            0
        }
    };

    // 3. CDN servers
    let cdn_servers = client
        .get_cdn_servers(CellId(0), Some(32))
        .await
        .map_err(|err| anyhow!("cdn servers: {err}"))?;
    if cdn_servers.is_empty() {
        return Err(anyhow!("Steam returned no CDN servers"));
    }
    let cdn_pool = CdnServerPool::new(cdn_servers);

    // 4. CDN auth token (optional, may fail for some depots)
    let first_server_host = cdn_pool.pick().0.host.clone();
    let cdn_auth_token = match client
        .get_cdn_auth_token(app_id, depot_id, &first_server_host)
        .await
    {
        Ok(token) => token,
        Err(err) => {
            let _ = debug_log::append(
                app,
                "steam.download",
                &format!("cdn auth token: {err}; proceeding without"),
            );
            steamroom::content::CdnAuthToken {
                token: None,
                expiration_time: None,
            }
        }
    };

    // 5. Download + decompress manifest
    let cdn = CdnClient::new().map_err(|err| anyhow!("cdn client: {err}"))?;
    let manifest_bytes = cdn
        .download_manifest_pooled(
            &cdn_pool,
            depot_id,
            manifest_id,
            request_code,
            cdn_auth_token.token.as_deref(),
        )
        .await
        .map_err(|err| anyhow!("manifest download: {err}"))?;

    let manifest_bytes = decompress_manifest(&manifest_bytes)?;
    let mut manifest = DepotManifest::parse(&manifest_bytes)
        .map_err(|err| anyhow!("manifest parse: {err}"))?;

    if manifest.filenames_encrypted {
        manifest
            .decrypt_filenames(&depot_key)
            .map_err(|err| anyhow!("filename decryption: {err}"))?;
    }

    let _ = debug_log::append(
        app,
        "steam.download",
        &format!(
            "manifest parsed: {} files, encrypted={}",
            manifest.files.len(),
            manifest.filenames_encrypted
        ),
    );

    // 6. Spawn the download job
    let (event_tx, event_rx) = unbounded_channel();
    let counters = Arc::new(ProgressCounters::default());
    spawn_event_bridge(app.clone(), event_rx, Arc::clone(&counters));

    let fetcher = CdnChunkFetcher::new(
        cdn,
        cdn_pool,
        cdn_auth_token.token.clone(),
    );

    let job = DepotJob::builder()
        .depot_id(depot_id)
        .depot_key(depot_key.clone())
        .install_dir(request.output_dir.clone())
        .verify(true)
        .event_sender(event_tx)
        .build()
        .map_err(|err| anyhow!("depot job build: {err}"))?;

    let stats = job
        .download(&manifest, Arc::new(fetcher))
        .await
        .map_err(|err| anyhow!("depot download: {err}"))?;

    let _ = debug_log::append(
        app,
        "steam.download",
        &format!(
            "depot download complete files_completed={} bytes={}",
            stats.files_completed, stats.bytes_downloaded
        ),
    );

    Ok(())
}

/// Steam CDN manifests are zip-compressed. If the response isn't zip, treat
/// it as raw bytes.
fn decompress_manifest(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() > 2 && data[0] == 0x50 && data[1] == 0x4B {
        let cursor = std::io::Cursor::new(data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|err| anyhow!("manifest zip open: {err}"))?;
        if archive.is_empty() {
            return Err(anyhow!("empty manifest zip archive"));
        }
        let mut file = archive
            .by_index(0)
            .map_err(|err| anyhow!("manifest zip entry: {err}"))?;
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut buf)
            .map_err(|err| anyhow!("manifest zip read: {err}"))?;
        Ok(buf)
    } else {
        Ok(data.to_vec())
    }
}
