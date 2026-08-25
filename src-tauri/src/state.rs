use crate::models::{GameLaunchState, OAuthCallbackPayload, UpdateStatus};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Default)]
pub struct UpdateRuntime {
    pub status: Option<UpdateStatus>,
    pub cancel_requested: bool,
    pub is_updating: bool,
}

#[derive(Debug, Default)]
pub struct GameRuntime {
    pub is_launching: bool,
    pub is_running: bool,
    pub active_pid: Option<u32>,
}

#[derive(Clone, Default)]
pub struct AppState {
    pub update_runtime: Arc<Mutex<UpdateRuntime>>,
    pub game_runtime: Arc<Mutex<GameRuntime>>,
    pub bootstrap_active: Arc<AtomicBool>,
    pub oauth_server_started: Arc<AtomicBool>,
    pub pending_oauth_callback: Arc<Mutex<Option<OAuthCallbackPayload>>>,
    pub processed_oauth_states: Arc<Mutex<HashMap<String, i64>>>,
    pub runtime_update_url: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn mark_oauth_server_started(&self) -> bool {
        self.oauth_server_started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn is_oauth_state_duplicate(&self, state: &str) -> bool {
        let now = Utc::now().timestamp_millis();
        let ttl_ms = 5 * 60 * 1000;

        if let Ok(mut guard) = self.processed_oauth_states.lock() {
            guard.retain(|_, ts| now - *ts <= ttl_ms);
            return guard.contains_key(state);
        }

        false
    }

    pub fn mark_oauth_state_processed(&self, state: String) {
        let now = Utc::now().timestamp_millis();
        let ttl_ms = 5 * 60 * 1000;

        if let Ok(mut guard) = self.processed_oauth_states.lock() {
            guard.retain(|_, ts| now - *ts <= ttl_ms);
            guard.insert(state, now);
        }
    }

    pub fn mark_bootstrap_active(&self) {
        self.bootstrap_active.store(true, Ordering::SeqCst);
    }

    pub fn finish_bootstrap(&self) {
        self.bootstrap_active.store(false, Ordering::SeqCst);
    }

    pub fn is_bootstrap_active(&self) -> bool {
        self.bootstrap_active.load(Ordering::SeqCst)
    }

    pub fn game_launch_state(&self) -> GameLaunchState {
        self.game_runtime
            .lock()
            .map(|guard| GameLaunchState {
                is_launching: guard.is_launching,
                is_running: guard.is_running,
            })
            .unwrap_or_default()
    }

    pub fn begin_game_launch(&self) -> GameLaunchState {
        if let Ok(mut guard) = self.game_runtime.lock() {
            guard.is_launching = true;
            guard.is_running = false;
            guard.active_pid = None;
            return GameLaunchState {
                is_launching: true,
                is_running: false,
            };
        }

        GameLaunchState {
            is_launching: true,
            is_running: false,
        }
    }

    pub fn mark_game_running(&self, pid: u32) -> GameLaunchState {
        if let Ok(mut guard) = self.game_runtime.lock() {
            guard.is_launching = false;
            guard.is_running = true;
            guard.active_pid = Some(pid);
            return GameLaunchState {
                is_launching: false,
                is_running: true,
            };
        }

        GameLaunchState {
            is_launching: false,
            is_running: true,
        }
    }

    pub fn reset_game_launch(&self) -> GameLaunchState {
        if let Ok(mut guard) = self.game_runtime.lock() {
            guard.is_launching = false;
            guard.is_running = false;
            guard.active_pid = None;
        }

        GameLaunchState::default()
    }

    pub fn clear_game_launch_if_pid_matches(&self, pid: u32) -> Option<GameLaunchState> {
        let mut guard = self.game_runtime.lock().ok()?;
        if guard.active_pid != Some(pid) {
            return None;
        }

        guard.is_launching = false;
        guard.is_running = false;
        guard.active_pid = None;

        Some(GameLaunchState::default())
    }

    pub fn set_runtime_update_url(&self, url: String) {
        let trimmed = url.trim().trim_end_matches('/').to_string();
        if let Ok(mut guard) = self.runtime_update_url.lock() {
            *guard = if trimmed.is_empty() { None } else { Some(trimmed) };
        }
    }

    pub fn get_runtime_update_url(&self) -> Option<String> {
        self.runtime_update_url.lock().ok().and_then(|g| g.clone())
    }

    pub fn get_update_base_url(&self) -> Option<String> {
        self.get_runtime_update_url()
    }
}
