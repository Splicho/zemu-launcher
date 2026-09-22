# ZEmu launcher API — friends, groups, presence, player icons

For the launcher (`Splicho/zemu-launcher`: Tauri 2, Rust `reqwest` + `serde`, React/TypeScript).
Plain HTTP + JSON, so it works the same from Rust, from `fetch` in the webview, or from a backend.

The `/api/...` routes below answer in **the JSON the launcher already declares** in
`src-tauri/src/friends.rs` (`FriendsGraph`, `Friend`, `FriendsActionResult`, camelCase), and follow
the endpoint list in that file's TODO. Pointing the stub at this server is the whole integration.

## Basics

| | |
|---|---|
| Base URL | `http://217.160.250.198:8126` — the game server itself, plain HTTP on TCP 8126. Quick check: `curl http://217.160.250.198:8126/health` → `{"ok":true}` |
| Who is calling | `Authorization: Bearer <the player's ZEmu auth key>` — the same key the launcher hands the game at launch. `?key=` works too. |
| Who is being added / invited | **Their in-game name** (`{"name":"Ghosty"}`) or their id (`{"id":"3613…"}`). Never anyone's key. |
| Ids | Character ids as **decimal strings** (they exceed 2^53). `Friend.id: String` fits as is. |
| Bodies | JSON. Player names are matched case-insensitively and must be exact (use search for partial). |
| CORS | Open (`*`), `Authorization` and `If-None-Match` allowed, `ETag` exposed — so CORS never blocks a webview `fetch` (the app's own CSP still can: see point 3 below). |
| Rate limit | 300 requests / minute / IP → `429`. |
| Multiple characters | The account's first character acts; add `?characterId=` to pick another. |

### Before you start — the four things that bite

1. **It is a different token from the platform one.** `api_get` / `api_post` in `src-tauri/src/api.rs`
   attach the `id.zemu.uk` OAuth token and resolve the platform base URL. This server knows nothing
   about that token → `401 unknown key`. Use a separate base URL and send the **player's ZEmu auth
   key** (the one in the launcher's auth-key dialog, `0x` + 16 hex digits).
2. **`http://`, not `https://`.** The port speaks plain HTTP; an https call dies in the TLS handshake
   and looks like "server down".
3. **Call it from Rust.** CORS is open, but a packaged webview can still refuse a plain-HTTP origin
   through the app's CSP (`connect-src`). `reqwest` has no such limit — and it is how `friends.rs` is
   already laid out. If you do call from the webview, add `http://217.160.250.198:8126` to the CSP.
4. **The account must have played once.** A key that has never logged into the game has no account
   here yet (`401`), and an account with no character cannot have friends (`401`). Show "launch the
   game once" rather than "API error".

Try it without writing code — in a browser, with your own key (do not share such a link: the key is
the account's game login): `http://217.160.250.198:8126/api/friends?key=<your key>`

**A refused action is still HTTP 200**, with `"ok": false` and a `"reason"`. `api_post` in the
launcher treats any non-2xx as a transport failure and never reads the body, so a 409 would turn
"already friends" into "request failed". Non-2xx is kept for: `401` no/unknown key (the account has
to have logged into the game once), `400`/`405` malformed call, `404`, `429`.

## 1 · Friends — `/api/friends`

| Launcher action | Call | Body | Answer |
|---|---|---|---|
| list | `GET /api/friends` | — | FriendsGraph |
| search | `GET /api/friends/search?q=gho` | — | FriendsGraph with `results` (2+ characters, up to 50) |
| request | `POST /api/friends/request` | `{"name":"Ghosty"}` or `{"id":"…"}` | FriendsActionResult |
| accept | `POST /api/friends/accept` | same | FriendsActionResult |
| decline | `POST /api/friends/decline` | same | FriendsActionResult |
| cancel (withdraw my request) | `POST /api/friends/cancel` | same | FriendsActionResult |
| remove (unfriend) | `POST /api/friends/remove` | same | FriendsActionResult |
| profile | `PUT /api/friends/profile` | — | always `ok:false`, `display_name_is_the_in_game_name` |

```jsonc
// FriendsGraph  (FriendsActionResult = the same object plus "ok" and, when refused, "reason")
{
  "self":     { "id": "3613…", "displayName": "Ghosty", "status": "online", "relationship": "self", … },
  "friends":  [ Friend ],
  "incoming": [ Friend ],      // requests waiting for ME  → accept / decline
  "outgoing": [ Friend ],      // requests I sent          → cancel
  "results":  [ Friend ],      // search only
  "directoryConfigured": true, // always: the display name is the in-game name
  "etag": "9F2C41D0A7B3E6F1"
}

// Friend — the launcher's four fields, plus extras serde ignores until you declare them
{
  "id": "8684…", "displayName": "Jiam",
  "status": "in_game",             // online | in_game | offline   (FriendStatus, snake_case)
  "relationship": "friend",        // self | friend | incoming | outgoing | none
  "lastSeen": null,                // OFFLINE only: "2026-09-18T15:41:07Z" (ISO 8601 UTC). null while online / in_game, and for someone never seen
  "avatarUrl": "/avatar/8684…",    // null when they have no icon; relative to the base URL
  "activity": "Duos",              // the mode while in_game, else null
  "atMenu": false,                 // true = can be invited to a group right now
  "partyId": 0                     // non-zero = already in a group
}
```

`reason` values: `player_not_found`, `already_friends`, `already_requested`, `no_pending_request`,
`not_friends`, `friend_limit_reached` (100), `pending_limit_reached` (50). Sending a request to
someone who already sent you one makes you friends at once. `cancel` only withdraws a request and
`remove` only unfriends — neither does the other's job.

**Pending requests on their own:** `GET /friends/requests` → `{ "received": [...], "sent": [...] }`
(native row shape, see the last section) — for a badge that polls without pulling the whole graph.

## 2 · Where a player is — `status`

| Launcher `status` | Native `status` | Means |
|---|---|---|
| `online` | `menu` | Game running, in the lobby / main menu. `atMenu:true` = can take a group invite now. |
| `in_game` | `in_match` | In a match world (staging, match or death screen). `activity` / `mode` names it: Solos, Duos, Fives. |
| `offline` | `offline` | Not connected to the game server. |

Match worlds are separate processes; each publishes who it holds every ~3 s and the API merges them,
so a change shows up within a few seconds and a crashed world's players age out after 12 s. The
launcher being open is not "online" — this is game presence. (`away` / `busy` are never sent.)

**`lastSeen`** — for an offline player, when they were last connected to the game, accurate to a few
seconds (`new Date(lastSeen)` / `chrono::DateTime<Utc>`). It is deliberately **`null` while they are
online**: "now" would change on every poll and the `ETag` / `304` below would never match again —
`status` already says they are here. Someone who has not been on since this was added shows their
last login time instead; someone who has never logged in, `null`.

## 3 · Groups (the in-game lobby party) — `/api/party`

| Call | Body | |
|---|---|---|
| `GET /api/party` | — | the caller's group |
| `POST /api/party/invite` | `{"name":"Jiam"}` / `{"id":"…"}` | leader only once a group exists |
| `POST /api/party/accept` | `{"name":"<leader>"}` or empty | empty = the one invite that is waiting |
| `POST /api/party/decline` | same | |
| `POST /api/party/kick` | `{"name":"…"}` | leader only |
| `POST /api/party/leave` | — | |

```jsonc
{
  "partyId": 4, "leaderId": "3613…", "isLeader": true,
  "members":    [ Friend ],   // includes the caller once a group exists
  "invitesIn":  [ Friend ],   // leaders who invited ME  → accept / decline
  "invitesOut": [ Friend ],   // players I invited, not answered yet
  "canAct": true,             // false = the caller's game is not at the main menu
  "startStaged": false,       // the leader pressed START; members are being pulled in
  "ok": true, "reason": "…", "message": "Invitation sent to Jiam."   // on actions only
}
```

⚠️ **The group lives in the game's lobby.** These routes drive the same party the in-game panel
shows — the invitee gets the native in-game invite either way — so **the caller's own game must be
running and on the main menu**, and so must the player being invited. Otherwise: `ok:false` with
`you_are_not_at_the_menu`, `player_is_offline`, `player_is_not_at_the_menu`, `no_pending_invite`,
`player_not_found`, or `refused` (+ a readable `message`: group full, only the leader can invite, a
start is in progress…). Grey the invite button unless `canAct` and the friend's `atMenu` are true.
Starting the match stays in game (START / FIND A GROUP).

## 4 · Player icon

| Call | |
|---|---|
| `POST /avatar` | Body = the raw image bytes (not multipart, not JSON). **PNG or JPEG, exactly 64×64, ≤ 256 KB.** → `{ "ok": true, "url": "/avatar/<id>", "contentType": "image/png", "bytes": 5120 }`; `400` + `required: {pixels, maxBytes, formats}` if it does not fit. |
| `DELETE /avatar` | → `{ "removed": true }` |
| `GET /avatar/<characterId>` | Public, no key. The image, or `404`. This is what the game itself loads in the friends panel, so a new icon shows in game with no further step. |
| `GET /avatars` | Public. `{ pixels, avatars: [{ characterId, url, stamp }] }` — `stamp` changes when the icon does (cache-bust with it). |
| `GET /upload` | Public browser page doing all of the above, for players without the launcher. |

Resize before uploading (the server validates, it does not resize) — centre-crop to a square, draw
to a 64×64 canvas, `canvas.toBlob(..., "image/png")`. In Rust: `image::imageops::resize` then PNG.

## 5 · Keeping the UI live (there is no Socket.IO here)

This server has no push channel; poll. `GET /api/friends` sends an `ETag` and answers a **bodiless
`304`** to a matching `If-None-Match`, so a poll that finds nothing new costs almost nothing.

- Friends panel open: every 3–5 s. Closed / tray: every 15–30 s. `GET /api/party`: every 2–3 s
  while a group or an invite exists.
- `200` → replace the graph and emit the launcher's existing `friends:graph-changed`.
- An id in `incoming` that was not there last time → emit `friends:incoming-request` with
  `{ fromUser: { id, displayName, avatarUrl } }` — the payload `friends_realtime.rs` already forwards.
- Same diff on `invitesIn` for a "group invite" toast.

## Rust (`src-tauri`) — drop-in for the `friends.rs` stub

```rust
use anyhow::{anyhow, Result};
use serde_json::json;

const ZEMU_API: &str = "http://217.160.250.198:8126";

/// `key` = the player's ZEmu auth key (what the launcher already passes to the game).
/// `etag` = the last one seen, to get Ok(None) on "nothing changed".
pub async fn friends_list(key: &str, etag: Option<&str>) -> Result<Option<(FriendsGraph, String)>> {
    let mut req = reqwest::Client::new().get(format!("{ZEMU_API}/api/friends")).bearer_auth(key);
    if let Some(tag) = etag {
        req = req.header(reqwest::header::IF_NONE_MATCH, tag);
    }
    let res = req.send().await?;
    if res.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(None);
    }
    let tag = res.headers().get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok()).unwrap_or_default().to_owned();
    let graph = res.error_for_status()?.json::<FriendsGraph>().await?;
    Ok(Some((graph, tag)))
}

/// action = "request" | "accept" | "decline" | "cancel" | "remove"
pub async fn friends_act(key: &str, action: &str, in_game_name: &str) -> Result<FriendsActionResult> {
    let res = reqwest::Client::new()
        .post(format!("{ZEMU_API}/api/friends/{action}"))
        .bearer_auth(key)
        .json(&json!({ "name": in_game_name }))      // or { "id": target_id }
        .send().await?
        .error_for_status()?                          // refusals are 200 + ok:false, not errors
        .json::<FriendsActionResult>().await?;
    if !res.ok {
        return Err(anyhow!(res.reason.clone().unwrap_or_else(|| "refused".into())));
    }
    Ok(res)
}

pub async fn set_icon(key: &str, png_64x64: Vec<u8>) -> Result<()> {
    reqwest::Client::new().post(format!("{ZEMU_API}/avatar"))
        .bearer_auth(key).header("Content-Type", "image/png").body(png_64x64)
        .send().await?.error_for_status()?;
    Ok(())
}
```

The existing structs deserialize unchanged. To use the extras, add to `Friend` (all optional):

```rust
#[serde(default)] pub last_seen: Option<String>,  // ISO 8601 UTC, offline only (or chrono::DateTime<Utc>)
#[serde(default)] pub avatar_url: Option<String>,
#[serde(default)] pub activity: Option<String>,   // "Solos" | "Duos" | "Fives" while in_game
#[serde(default)] pub at_menu: bool,
#[serde(default)] pub party_id: u32,
```

## TypeScript (webview)

```ts
const ZEMU_API = "http://217.160.250.198:8126";

async function zemu<T>(key: string, path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
  const res = await fetch(ZEMU_API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`zemu api ${res.status}`);
  return res.json();
}

await zemu(key, "/api/friends/request", { name: "Jiam" });   // -> { ok, reason?, friends, incoming, … }
await zemu(key, "/api/party/invite", { name: "Jiam" });      // -> { ok, reason?, message?, members, … }
const graph = await zemu<FriendsGraph>(key, "/api/friends");
```

## Errors and troubleshooting

Every non-2xx answer is `{ "error": "<readable text>" }`:

| Status | `error` | What to do |
|---|---|---|
| 401 | `key=<auth key> (or Authorization: Bearer) or characterId is required` | The header did not arrive — check the client actually sends `Authorization`. |
| 401 | `unknown key - the account has not logged into the game yet` | Wrong token (the platform one?), or that key has never logged into the game. |
| 401 | `that account has no character yet` | The player has to create a character in game first. |
| 401 | `characterId is not a character of that account` | Drop `?characterId=` or pass one of theirs. |
| 400 / 405 | names the missing field / the method to use | |
| 404 | `not found` | Wrong path — they are listed above, no trailing version prefix. |
| 429 | `rate limited` | Over 300 requests a minute from one IP — slow the poll down. |

- **Is it reachable?** `curl -i http://217.160.250.198:8126/health` → `200 {"ok":true}`.
- **Instant "unable to connect" / connection refused** while `/health` works elsewhere: the
  connection is being refused near the caller, not here — VPN or proxy, an antivirus web shield, or
  a network that only lets out ports 80/443. A timeout instead means a firewall dropped it.
- **An icon that does not update:** the URL never changes (`/avatar/<id>`), so add a cache-buster
  after an upload — `?v=<stamp>` with the `stamp` from `GET /avatars`, or the current time.
- **A friend stuck `offline` while playing:** presence follows the game connection, within ~3–12 s.
  `GET /me` with their key shows what the server thinks (`status`, `mode`).

## Native routes (older shape — still served, used by the in-game tools and `/upload`)

`GET /me`, `/players/online`, `/players/search?name=`, `/friends`, `/friends/requests`,
`/friends/add|accept|decline|remove?targetName=|targetId=`, `/party/status`,
`/party/invite|kick?targetName=|targetId=`, `/party/accept|decline?leaderId=|leaderName=` (neither =
the waiting invite), `/party/leave`. Rows are
`{ characterId, name, online, status: offline|menu|in_match, mode, atMenu, partyId, lastSeen, relation: 0-3, avatar }`
(`relation`: 0 none, 1 friend, 2 request received, 3 request sent). These answer refusals with `409`.

## Calling from a backend instead of the launcher

If the platform backend (`id.zemu.uk`) should make these calls rather than each launcher, set
`"PartyApiServiceToken": "<32+ random characters>"` in `/opt/zemu/server.json` and restart. A call
bearing that token names the acting player itself: `?characterName=Ghosty` (or `?characterId=`).
Off by default. **Never ship that token inside the launcher** — whoever holds it can act as anyone;
a launcher on a player's PC uses that player's own auth key.
