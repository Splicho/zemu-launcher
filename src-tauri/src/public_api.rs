use anyhow::{anyhow, Result};
use serde::Serialize;
use std::time::Duration;
use url::Url;

#[derive(Debug, Serialize)]
pub struct PublicApiResponse {
    pub status: u16,
    pub body: String,
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
}
