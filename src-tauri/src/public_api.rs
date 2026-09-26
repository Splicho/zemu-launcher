use anyhow::{anyhow, Result};
use base64::Engine;
use serde::Serialize;
use std::time::Duration;
use url::Url;

#[derive(Debug, Serialize)]
pub struct PublicApiResponse {
    pub status: u16,
    pub body: String,
}

/// Successful image download. Bytes are returned as base64 because
/// Tauri's IPC layer is text-based and raw `Vec<u8>` would force the
/// renderer to round-trip through a base64 encode/decode anyway.
/// `content_type` is preserved so the renderer can build a `Blob`
/// with the right MIME.
///
/// Field names are serialized as camelCase to match the rest of the
/// launcher's JS-side bridge (`launcherAPI.fetchAvatarBytes`
/// destructures `{ status, contentType, bodyBase64 }`). Without the
/// rename, Rust's default snake_case would emit `body_base64` and
/// `content_type`, leaving `bodyBase64` `undefined` and breaking
/// the `atob` decode downstream.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicImageResponse {
    pub status: u16,
    pub content_type: String,
    /// Standard base64 (RFC 4648). Decode with `atob` / `Uint8Array`.
    pub body_base64: String,
}

pub async fn get(url: &str) -> Result<PublicApiResponse> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()?;
    get_with_client(&client, url).await
}

fn parse_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(anyhow!(
            "Public API requests require an HTTP(S) URL without credentials"
        ));
    }
    Ok(url)
}

async fn get_with_client(client: &reqwest::Client, url: &str) -> Result<PublicApiResponse> {
    // These endpoints are public: do not attach the launcher bearer, cookies,
    // or the WebView Origin. Keep HTTP errors for callers (e.g. news 404).
    let response = client
        .get(parse_url(url)?)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| anyhow!("Public API request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| anyhow!("Public API response read failed: {error}"))?;
    Ok(PublicApiResponse { status, body })
}

/// Download an arbitrary remote file as raw bytes. No CORS check
/// (runs natively), no JSON / UTF-8 assumption (`response.text()`
/// would corrupt binary bytes).
///
/// Used by the launcher's avatar-sync pipeline: the webview's
/// `fetch(..., { mode: 'cors' })` is rejected by CDNs that don't
/// send `Access-Control-Allow-Origin` headers — the same URL
/// renders fine in `<img>`, but `fetch` silently throws
/// "Failed to fetch". Going native via `reqwest` sidesteps CORS
/// entirely so the avatar upload completes regardless of the
/// CDN's headers.
///
/// Returns the response content-type alongside the base64 bytes
/// so the renderer can build a `Blob` with the correct MIME for
/// `createImageBitmap`.
pub async fn get_image(url: &str) -> Result<PublicImageResponse> {
    // 10 MiB cap matches `apps/api/src/r2/r2.service.ts`
    // `AVATAR_MAX_BYTES` (6 MiB) with some headroom — the launcher
    // downsamples whatever it gets to 64x64 PNG before POSTing,
    // so anything bigger than ~6 MiB is almost certainly
    // wrong-shaped (we don't want a 50 MiB "avatar" stalling the
    // upload pipeline and pinning a network connection).
    const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()?;
    let response = client
        .get(parse_url(url)?)
        .send()
        .await
        .map_err(|error| anyhow!("Image request failed: {error}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| anyhow!("Image response read failed: {error}"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(anyhow!(
            "Image response too large ({} bytes > {} max)",
            bytes.len(),
            MAX_IMAGE_BYTES
        ));
    }
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(PublicImageResponse {
        status,
        content_type,
        body_base64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiny_http::{Response, Server};

    #[test]
    fn accepts_public_and_development_urls_without_credentials() {
        for url in [
            "https://api.zemu.uk/v1/news",
            "http://localhost:3002/streams",
        ] {
            assert!(parse_url(url).is_ok());
        }
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/data",
            "https://user:secret@example.com",
        ] {
            assert!(parse_url(url).is_err());
        }
    }

    #[tokio::test]
    async fn anonymous_get_preserves_paths_queries_and_http_statuses() {
        for (path, status, body) in [
            ("/v1/news", 200, "[{\"slug\":\"hello\"}]"),
            ("/v1/news/missing", 404, "not found"),
            (
                "/v1/stats/leaderboards?limit=5&tier=gold",
                200,
                "{\"entries\":[]}",
            ),
            ("/streams", 503, "service unavailable"),
        ] {
            let server = Server::http("127.0.0.1:0").unwrap();
            let address = server.server_addr().to_ip().unwrap();
            let worker = std::thread::spawn(move || {
                let request = server
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                assert_eq!(request.method(), &tiny_http::Method::Get);
                assert_eq!(request.url(), path);
                for header in request.headers() {
                    assert!(!header.field.equiv("Origin"));
                    assert!(!header.field.equiv("Authorization"));
                    assert!(!header.field.equiv("Cookie"));
                }
                // No CORS response headers: native requests must still work.
                request
                    .respond(Response::from_string(body).with_status_code(status))
                    .unwrap();
            });
            let response = get(&format!("http://{address}{path}")).await.unwrap();
            worker.join().unwrap();
            assert_eq!(response.status, status);
            assert_eq!(response.body, body);
        }
    }

    #[tokio::test]
    async fn stalled_requests_timeout_instead_of_leaving_the_ui_loading() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let worker = std::thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            std::thread::sleep(Duration::from_millis(100));
            let _ = request.respond(Response::from_string("[]"));
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let error = get_with_client(&client, &format!("http://{address}/streams"))
            .await
            .unwrap_err();
        worker.join().unwrap();
        assert!(error.to_string().contains("Public API request failed"));
    }

    /// `PublicImageResponse` is consumed by the renderer's
    /// `launcherAPI.fetchAvatarBytes`, which destructures
    /// `{ status, contentType, bodyBase64 }`. Serde's default
    /// snake_case would rename `body_base64` to itself and
    /// `content_type` to itself — leaving the camelCase keys as
    /// `undefined` on the JS side and crashing `atob(undefined)`
    /// inside `fetchAvatarBlob`. This test pins the camelCase
    /// wire format so future serde refactors can't silently
    /// regress the IPC bridge.
    #[test]
    fn image_response_serializes_in_camel_case() {
        let response = PublicImageResponse {
            status: 200,
            content_type: "image/jpeg".to_string(),
            body_base64: "aGVsbG8=".to_string(),
        };
        let value = serde_json::to_value(&response).unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(object.get("status").unwrap().as_u64(), Some(200));
        assert_eq!(
            object.get("contentType").unwrap().as_str(),
            Some("image/jpeg"),
        );
        assert_eq!(
            object.get("bodyBase64").unwrap().as_str(),
            Some("aGVsbG8="),
        );
        // And — equally importantly — that the snake_case forms
        // do NOT leak through. If they did, the renderer's
        // `result.bodyBase64` would be `undefined` because the JS
        // destructure would see only `body_base64`.
        assert!(object.get("body_base64").is_none());
        assert!(object.get("content_type").is_none());
    }
}
