//! Bridge between `steamroom-client`'s `DownloadEvent` enum and the
//! `depot-progress` JSON events emitted to the React UI.
//!
//! The download pipeline sends events into an unbounded channel; this
//! module drains that channel on a background tokio task and re-emits each
//! event as a serializable `DepotProgress` to the renderer.

use crate::debug_log;
use crate::models::{DepotPhase, DepotProgress};
use crate::steam::emit_progress;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use steamroom_client::event::DownloadEvent;
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedReceiver;

/// Aggregate counters shared between the download worker and the event
/// bridge so the bridge can compute percent-complete and file totals even
/// when individual events don't carry them.
#[derive(Debug, Default)]
pub struct ProgressCounters {
    pub completed_bytes: AtomicU64,
    pub total_bytes: AtomicU64,
    pub completed_files: AtomicU64,
    pub total_files: AtomicU64,
}

impl ProgressCounters {
    pub fn snapshot(&self) -> DepotProgress {
        let completed = self.completed_bytes.load(Ordering::Relaxed);
        let total = self.total_bytes.load(Ordering::Relaxed);
        let percent = if total > 0 {
            Some((completed as f64 / total as f64) * 100.0)
        } else {
            Some(0.0)
        };
        DepotProgress {
            phase: DepotPhase::ChunkProgress,
            current_file: None,
            completed_bytes: Some(completed),
            total_bytes: Some(total),
            completed_files: Some(self.completed_files.load(Ordering::Relaxed)),
            total_files: Some(self.total_files.load(Ordering::Relaxed)),
            percent,
            message: None,
            error: None,
        }
    }
}

/// Spawn a background task that consumes `DownloadEvent`s from `rx` and
/// re-emits them as `depot-progress` events. Returns when the channel
/// closes (i.e. the download job has been dropped).
pub fn spawn_event_bridge(
    app: AppHandle,
    mut rx: UnboundedReceiver<DownloadEvent>,
    counters: Arc<ProgressCounters>,
) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let progress = translate_event(&app, event, &counters);
            if let Some(progress) = progress {
                emit_progress(&app, progress);
            }
        }
        let _ = debug_log::append(&app, "steam.progress", "event bridge closed");
    });
}

fn translate_event(
    app: &AppHandle,
    event: DownloadEvent,
    counters: &ProgressCounters,
) -> Option<DepotProgress> {
    let _ = debug_log::append(app, "steam.progress", &format!("event={event:?}"));
    match event {
        DownloadEvent::DownloadStarted {
            total_bytes,
            total_files,
        } => {
            counters
                .total_bytes
                .store(total_bytes, Ordering::Relaxed);
            counters
                .total_files
                .store(total_files, Ordering::Relaxed);
            Some(DepotProgress::started(total_bytes, total_files))
        }
        DownloadEvent::FileStarted { filename } => Some(DepotProgress::file_started(&filename)),
        DownloadEvent::FileCompleted { .. } => {
            counters
                .completed_files
                .fetch_add(1, Ordering::Relaxed);
            None
        }
        DownloadEvent::FileSkipped { .. } => None,
        DownloadEvent::FileRemoved { .. } => None,
        DownloadEvent::ChunkCompleted { bytes } => {
            counters.completed_bytes.fetch_add(bytes, Ordering::Relaxed);
            Some(counters.snapshot())
        }
        DownloadEvent::ChunkFailed { error } => Some(DepotProgress::failed(format!(
            "Chunk download failed: {}",
            error
        ))),
        DownloadEvent::DepotProgress {
            completed_bytes,
            total_bytes,
        } => {
            counters.completed_bytes.store(completed_bytes, Ordering::Relaxed);
            counters.total_bytes.store(total_bytes, Ordering::Relaxed);
            Some(counters.snapshot())
        }
        // Forward-compat: unknown variants are silently ignored so a future
        // steamroom-client release can't crash the bridge.
        _ => None,
    }
}
