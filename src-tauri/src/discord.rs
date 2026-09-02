use crate::debug_log;
use anyhow::{anyhow, Result};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

// Discord Rich Presence client ID. Owned by the launcher application and
// created in the Discord developer portal. The Rich Presence Art Asset
// referenced by every state is uploaded under the key `app_logo`.
const DISCORD_CLIENT_ID: &str = "1542061186600804352";

const RETRY_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
struct DesiredActivity {
    state_label: String,
    details: Option<String>,
    large_image: Option<String>,
    large_text: Option<String>,
}

/// Hardcoded buttons shown on the Discord Rich Presence card.
///
/// Discord limits Rich Presence to a maximum of 2 buttons, and the
/// `label` field caps at 32 characters. These are intentionally
/// compile-time constants — they aren't user-configurable.
const DISCORD_BUTTONS: &[(&str, &str)] = &[
    ("Website", "https://zemu.uk"),
    ("Play the game", "https://zemu.uk/play"),
];

#[allow(dead_code)]
enum DiscordCommand {
    SetLauncher,
    SetInGame,
    SetActivity { details: String, state: String },
    Shutdown,
}

static DISCORD_SENDER: OnceLock<Sender<DiscordCommand>> = OnceLock::new();

pub fn initialize(app: &AppHandle) {
    if DISCORD_SENDER.get().is_some() {
        return;
    }

    let (tx, rx) = channel::<DiscordCommand>();
    if DISCORD_SENDER.set(tx).is_err() {
        return;
    }

    let app_handle = app.clone();
    thread::spawn(move || worker_loop(app_handle, rx));
}

pub fn set_in_launcher(app: &AppHandle) -> Result<()> {
    let _ = debug_log::append(app, "discord", "set_in_launcher queued");
    send_command(DiscordCommand::SetLauncher)
}

pub fn set_in_game(app: &AppHandle) -> Result<()> {
    let _ = debug_log::append(app, "discord", "set_in_game queued");
    send_command(DiscordCommand::SetInGame)
}

pub fn set_activity(app: &AppHandle, details: String, state: String) -> Result<()> {
    let _ = debug_log::append(
        app,
        "discord",
        &format!("set_activity details={details} state={state}"),
    );
    send_command(DiscordCommand::SetActivity { details, state })
}

fn send_command(command: DiscordCommand) -> Result<()> {
    let sender = DISCORD_SENDER
        .get()
        .ok_or_else(|| anyhow!("Discord worker not initialized"))?;
    sender
        .send(command)
        .map_err(|error| anyhow!("Failed to enqueue Discord command: {error}"))
}

fn is_enabled(app: &AppHandle) -> bool {
    crate::storage::load_launcher_config(app)
        .map(|config| config.discord_rpc_enabled)
        .unwrap_or(true)
}

fn rpc_mode(app: &AppHandle) -> crate::models::DiscordRpcMode {
    crate::storage::load_launcher_config(app)
        .map(|config| config.discord_rpc_mode)
        .unwrap_or(crate::models::DiscordRpcMode::Always)
}

fn worker_loop(app: AppHandle, rx: std::sync::mpsc::Receiver<DiscordCommand>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut desired: Option<DesiredActivity> = None;

    loop {
        match rx.recv_timeout(RETRY_INTERVAL) {
            Ok(DiscordCommand::Shutdown) => {
                if let Some(mut active) = client.take() {
                    let _ = active.close();
                }
                break;
            }
            Ok(DiscordCommand::SetLauncher) => {
                if !is_enabled(&app) {
                    if let Some(mut active) = client.take() {
                        let _ = active.close();
                    }
                    desired = None;
                    continue;
                }
                // "Playing only" mode suppresses the launcher presence.
                if rpc_mode(&app) == crate::models::DiscordRpcMode::PlayingOnly {
                    if let Some(mut active) = client.take() {
                        let _ = active.close();
                    }
                    desired = None;
                    continue;
                }
                desired = Some(DesiredActivity {
                    state_label: "In Launcher".to_string(),
                    details: Some("Browsing ZEmu".to_string()),
                    large_image: Some("app_logo".to_string()),
                    large_text: Some("ZEmu Launcher".to_string()),
                });
                if let Err(error) = apply_activity(&mut client, desired.as_ref()) {
                    let _ = debug_log::append(
                        &app,
                        "discord",
                        &format!("set_in_launcher apply_error={error}"),
                    );
                }
            }
            Ok(DiscordCommand::SetInGame) => {
                if !is_enabled(&app) {
                    if let Some(mut active) = client.take() {
                        let _ = active.close();
                    }
                    desired = None;
                    continue;
                }
                desired = Some(DesiredActivity {
                    state_label: "Playing".to_string(),
                    details: Some("In-game".to_string()),
                    large_image: Some("app_logo".to_string()),
                    large_text: Some("Zemu".to_string()),
                });
                if let Err(error) = apply_activity(&mut client, desired.as_ref()) {
                    let _ = debug_log::append(
                        &app,
                        "discord",
                        &format!("set_in_game apply_error={error}"),
                    );
                }
            }
            Ok(DiscordCommand::SetActivity { details, state }) => {
                if !is_enabled(&app) {
                    if let Some(mut active) = client.take() {
                        let _ = active.close();
                    }
                    desired = None;
                    continue;
                }
                desired = Some(DesiredActivity {
                    state_label: state,
                    details: Some(details),
                    large_image: Some("app_logo".to_string()),
                    large_text: Some("Zemu Launcher".to_string()),
                });
                if let Err(error) = apply_activity(&mut client, desired.as_ref()) {
                    let _ = debug_log::append(
                        &app,
                        "discord",
                        &format!("set_activity apply_error={error}"),
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !is_enabled(&app) {
                    if let Some(mut active) = client.take() {
                        let _ = active.close();
                    }
                    desired = None;
                    continue;
                }
                if desired.is_some() && client.is_none() {
                    if let Err(error) = apply_activity(&mut client, desired.as_ref()) {
                        let _ = debug_log::append(
                            &app,
                            "discord",
                            &format!("retry connect error={error}"),
                        );
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if let Some(mut active) = client.take() {
        let _ = active.close();
    }
}

fn ensure_connected(client: &mut Option<DiscordIpcClient>) -> Result<&mut DiscordIpcClient> {
    if client.is_none() {
        let mut new_client = DiscordIpcClient::new(DISCORD_CLIENT_ID);
        new_client
            .connect()
            .map_err(|error| anyhow!("Discord connect failed: {error}"))?;
        *client = Some(new_client);
    }

    match client.as_mut() {
        Some(active) => Ok(active),
        None => unreachable!("client present after ensure_connected"),
    }
}

fn apply_activity(
    client: &mut Option<DiscordIpcClient>,
    desired: Option<&DesiredActivity>,
) -> Result<()> {
    let Some(desired) = desired else {
        return Ok(());
    };

    let active = ensure_connected(client)?;

    let assets = activity::Assets::new()
        .large_image(desired.large_image.as_deref().unwrap_or("app_logo"))
        .large_text(desired.large_text.as_deref().unwrap_or("Zemu Launcher"));

    let buttons: Vec<_> = DISCORD_BUTTONS
        .iter()
        .take(2)
        .map(|(label, url)| activity::Button::new(*label, *url))
        .collect();

    let mut builder = activity::Activity::new()
        .state(&desired.state_label)
        .assets(assets)
        .buttons(buttons);

    if let Some(details) = desired.details.as_deref() {
        builder = builder.details(details);
    }

    active
        .set_activity(builder)
        .map_err(|error| anyhow!("Discord set_activity failed: {error}"))?;
    Ok(())
}
