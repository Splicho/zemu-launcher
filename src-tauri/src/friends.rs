//! Friends IPC surface — currently a stub.
//!
//! Every command funnels through `dispatch`, which always returns
//! `ok: false, reason: "not_implemented"` until the lead developer
//! hands over the game-side API. Once the real backend lands, only
//! the body of `dispatch` needs to change; the IPC contract (the
//! `FriendsAction` discriminator, the `FriendsActionResult` shape,
//! and the eight wrapper commands) is already defined and matches the
//! reference repo's `friends.js` payload byte-for-byte.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Online presence indicator. Unknown server-side values deserialize
/// to `Offline` so the frontend never crashes on an unknown enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FriendStatus {
    Online,
    Away,
    Busy,
    InGame,
    Offline,
}

impl Default for FriendStatus {
    fn default() -> Self {
        FriendStatus::Offline
    }
}

/// How the listed person relates to the signed-in user. Used by the
/// React panel to pick which action buttons to render.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FriendRelationship {
    /// The signed-in user (when listed in `results`).
    #[serde(rename = "self")]
    SelfUser,
    /// Already friends (mutual accepted).
    Friend,
    /// Someone who sent *us* a request.
    Incoming,
    /// Someone *we* sent a request to.
    Outgoing,
    /// No prior relationship — the panel shows an `add` button.
    None,
}

impl Default for FriendRelationship {
    fn default() -> Self {
        FriendRelationship::None
    }
}

/// A single person the signed-in user can see in the friends list.
/// `id` is the stable backend identifier; `display_name` is what the
/// UI shows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub id: String,
    pub display_name: String,
    pub status: FriendStatus,
    pub relationship: FriendRelationship,
}

/// The full friends state we ship to the renderer in one payload.
/// `results` carries the most recent search hits; everything else is
/// the long-lived lists that survive across navigations.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendsGraph {
    #[serde(default)]
    pub self_: Option<Friend>,
    #[serde(default)]
    pub friends: Vec<Friend>,
    #[serde(default)]
    pub incoming: Vec<Friend>,
    #[serde(default)]
    pub outgoing: Vec<Friend>,
    #[serde(default)]
    pub results: Vec<Friend>,
    /// `true` when the backend already knows the player's display name
    /// (e.g. via the in-game directory) and the panel should hide the
    /// "set your name" form.
    #[serde(default)]
    pub directory_configured: bool,
}

/// What the renderer wants the backend to do. The single
/// `dispatch` command takes one of these as a string discriminator;
/// the eight thin wrappers in `commands.rs` exist purely so the
/// `tauri::generate_handler!` macro can statically verify each
/// surface.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FriendsAction {
    List,
    Search,
    Request,
    Accept,
    Decline,
    Cancel,
    Remove,
    Profile,
}

impl FriendsAction {
    /// Parse from the renderer-provided string. Mirrors serde's
    /// `lowercase` rename so e.g. `"in_game"` deserializes correctly
    /// when we eventually add it.
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "list" => Some(FriendsAction::List),
            "search" => Some(FriendsAction::Search),
            "request" => Some(FriendsAction::Request),
            "accept" => Some(FriendsAction::Accept),
            "decline" => Some(FriendsAction::Decline),
            "cancel" => Some(FriendsAction::Cancel),
            "remove" => Some(FriendsAction::Remove),
            "profile" => Some(FriendsAction::Profile),
            _ => None,
        }
    }
}

/// Per-call payload. Every field is optional — only `list` and
/// `profile` carry values today, but the others will too once the
/// real API lands.
///
/// The fields are part of the public IPC contract even though the
/// stubbed `dispatch` doesn't read them yet. Suppressing the unused-
/// field lint so future engineers don't accidentally remove what the
/// real API will need.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendsPayload {
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub query: Option<String>,
}

/// What the renderer gets back from every action. `ok: false` is the
/// default stubbed shape; once the real backend lands, the action
/// implementations will populate `ok: true` plus the new graph.
///
/// We flatten the graph fields into the top-level JSON object (via
/// `#[serde(flatten)]`) so the TypeScript type matches the reference
/// repo's payload exactly — the renderer reads `result.friends` and
/// `result.reason` off the same level, not nested under `result.graph`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsActionResult {
    #[serde(flatten)]
    pub graph: FriendsGraph,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl Default for FriendsActionResult {
    fn default() -> Self {
        Self {
            graph: FriendsGraph::default(),
            ok: false,
            reason: Some("not_implemented".to_string()),
        }
    }
}

/// Single dispatcher — currently a stub that always reports
/// `not_implemented`.
///
/// TODO: wire up the real friends API once the lead developer hands it
/// over. The expected shape, per the reference repo, is:
///
/// ```text
/// list     → GET  /api/friends                  → FriendsGraph
/// search   → GET  /api/friends/search?q=...     → FriendsGraph (results)
/// request  → POST /api/friends/request  {id}    → FriendsActionResult
/// accept   → POST /api/friends/accept   {id}    → FriendsActionResult
/// decline  → POST /api/friends/decline  {id}    → FriendsActionResult
/// cancel   → POST /api/friends/cancel   {id}    → FriendsActionResult
/// remove   → POST /api/friends/remove   {id}    → FriendsActionResult
/// profile  → PUT  /api/friends/profile  {name}  → FriendsActionResult
/// ```
///
/// Every action returns a fresh `FriendsActionResult` so the renderer
/// can adopt it directly (see `lib/friends.ts` → `dispatchFriends`).
pub async fn dispatch(
    _app: &AppHandle,
    action: &str,
    _payload: FriendsPayload,
) -> FriendsActionResult {
    // Reject unknown actions explicitly rather than silently coercing
    // them to `list` — the renderer never sends unknowns, so any
    // unknown value here is a bug we want to surface in the logs.
    if FriendsAction::parse(action).is_none() {
        eprintln!("[friends] unknown action {action:?}");
        return FriendsActionResult {
            ok: false,
            reason: Some("unknown_action".to_string()),
            ..FriendsActionResult::default()
        };
    }

    // Real implementation goes here. For now: stub.
    FriendsActionResult::default()
}

// ---------------------------------------------------------------------------
// Internal dispatch helpers
//
// Each helper is the Rust-side body of a `#[tauri::command]` wrapper in
// `commands.rs`. We keep them as plain `pub` functions (no
// `#[tauri::command]`) so the macros in `commands.rs` can wrap them
// without colliding on the generated `__cmd__<name>` symbols.
// ---------------------------------------------------------------------------

pub async fn friends_dispatch(
    app: tauri::AppHandle,
    action: String,
    payload: Option<FriendsPayload>,
) -> FriendsActionResult {
    let payload = payload.unwrap_or_default();
    dispatch(&app, &action, payload).await
}

pub async fn friends_list(app: tauri::AppHandle) -> FriendsActionResult {
    dispatch(&app, "list", FriendsPayload::default()).await
}

pub async fn friends_search(
    app: tauri::AppHandle,
    query: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "search",
        FriendsPayload {
            query: Some(query),
            ..FriendsPayload::default()
        },
    )
    .await
}

pub async fn friends_request(
    app: tauri::AppHandle,
    target_id: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "request",
        FriendsPayload {
            target_id: Some(target_id),
            ..FriendsPayload::default()
        },
    )
    .await
}

pub async fn friends_accept(
    app: tauri::AppHandle,
    target_id: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "accept",
        FriendsPayload {
            target_id: Some(target_id),
            ..FriendsPayload::default()
        },
    )
    .await
}

pub async fn friends_decline(
    app: tauri::AppHandle,
    target_id: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "decline",
        FriendsPayload {
            target_id: Some(target_id),
            ..FriendsPayload::default()
        },
    )
    .await
}

pub async fn friends_cancel(
    app: tauri::AppHandle,
    target_id: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "cancel",
        FriendsPayload {
            target_id: Some(target_id),
            ..FriendsPayload::default()
        },
    )
    .await
}

pub async fn friends_remove(
    app: tauri::AppHandle,
    target_id: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "remove",
        FriendsPayload {
            target_id: Some(target_id),
            ..FriendsPayload::default()
        },
    )
    .await
}

pub async fn friends_save_profile(
    app: tauri::AppHandle,
    display_name: String,
) -> FriendsActionResult {
    dispatch(
        &app,
        "profile",
        FriendsPayload {
            display_name: Some(display_name),
            ..FriendsPayload::default()
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// Tests — lock in the IPC contract so a future serde rename on either
// side fails the build instead of silently breaking the renderer.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friend_status_serializes_to_snake_case() {
        let json = serde_json::to_string(&FriendStatus::InGame).unwrap();
        assert_eq!(json, "\"in_game\"");
    }

    #[test]
    fn friend_relationship_serializes_to_lowercase() {
        let json = serde_json::to_string(&FriendRelationship::SelfUser).unwrap();
        assert_eq!(json, "\"self\"");
    }

    #[test]
    fn empty_action_result_is_not_implemented() {
        let result = FriendsActionResult::default();
        assert!(!result.ok);
        assert_eq!(result.reason.as_deref(), Some("not_implemented"));
        assert!(result.graph.friends.is_empty());
        assert!(result.graph.incoming.is_empty());
        assert!(result.graph.outgoing.is_empty());
        assert!(result.graph.results.is_empty());
        assert!(result.graph.self_.is_none());
        assert!(!result.graph.directory_configured);
    }

    #[test]
    fn friend_payload_accepts_camel_case() {
        let raw = serde_json::json!({
            "targetId": "abc",
            "displayName": "n",
            "query": "q",
        });
        let payload: FriendsPayload = serde_json::from_value(raw).unwrap();
        assert_eq!(payload.target_id.as_deref(), Some("abc"));
        assert_eq!(payload.display_name.as_deref(), Some("n"));
        assert_eq!(payload.query.as_deref(), Some("q"));
    }

    #[test]
    fn action_parser_handles_all_known_values() {
        for raw in [
            "list", "search", "request", "accept", "decline", "cancel", "remove", "profile",
        ] {
            assert!(
                FriendsAction::parse(raw).is_some(),
                "expected {raw} to parse"
            );
        }
        assert!(FriendsAction::parse("nope").is_none());
    }
}
