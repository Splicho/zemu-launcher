use anyhow::{anyhow, Result};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client, Method,
};
use serde::Serialize;
use std::time::Duration;
use url::Url;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub url: String,
}

pub async fn request(
    url: &str,
    method: &str,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
    redirect: &str,
) -> Result<HttpResponse> {
    let policy = match redirect {
        "follow" => reqwest::redirect::Policy::limited(10),
        "error" => {
            reqwest::redirect::Policy::custom(|attempt| attempt.error("Redirect disallowed"))
        }
        _ => return Err(anyhow!("Unsupported redirect mode")),
    };
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(policy)
        .build()?;
    request_with_client(&client, url, method, headers, body).await
}

fn parse_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(anyhow!(
            "HTTP requests require an HTTP(S) URL without credentials"
        ));
    }
    Ok(url)
}

async fn request_with_client(
    client: &Client,
    url: &str,
    method: &str,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
) -> Result<HttpResponse> {
    let method = Method::from_bytes(method.as_bytes())?;
    if !matches!(
        method,
        Method::GET
            | Method::HEAD
            | Method::POST
            | Method::PUT
            | Method::PATCH
            | Method::DELETE
            | Method::OPTIONS
    ) {
        return Err(anyhow!("Unsupported HTTP method"));
    }
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())?;
        // The native client controls transport headers. It has no browser
        // cookie jar and must not forward the WebView's origin or cookies.
        if matches!(
            name.as_str(),
            "origin" | "cookie" | "host" | "content-length" | "connection" | "transfer-encoding"
        ) {
            continue;
        }
        header_map.append(name, HeaderValue::from_str(&value)?);
    }
    let mut request = client.request(method, parse_url(url)?).headers(header_map);
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| anyhow!("HTTP request failed: {error}"))?;
    let status = response.status();
    let url = response.url().to_string();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| name.as_str() != "set-cookie")
        .map(|(name, value)| Ok((name.to_string(), value.to_str()?.to_owned())))
        .collect::<Result<Vec<_>>>()?;
    let body = response
        .bytes()
        .await
        .map_err(|error| anyhow!("HTTP response read failed: {error}"))?
        .to_vec();
    // HTTP errors remain responses; only transport failures reject the IPC call.
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").into(),
        headers,
        body,
        url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiny_http::{Response, Server};

    #[test]
    fn validates_http_urls() {
        for url in [
            "https://api.zemu.uk/v1/friends",
            "http://localhost:3002/v1/friends/search-users?q=a%20b",
        ] {
            assert!(parse_url(url).is_ok());
        }
        for url in [
            "file:///v1/friends",
            "https://user:secret@example.com/v1/friends",
            "ftp://example.com/file",
        ] {
            assert!(parse_url(url).is_err());
        }
    }

    #[tokio::test]
    async fn forwards_authenticated_methods_bodies_and_http_errors_without_cors() {
        for (method, path, body, status, response_body) in [
            (
                "GET",
                "/v1/friends/search-users?q=%C3%A9t%C3%A9%20%2F&limit=10",
                None,
                200,
                "{\"users\":[]}",
            ),
            (
                "POST",
                "/v1/friends/requests/player%2Fid",
                None,
                201,
                "{\"id\":\"request\"}",
            ),
            ("POST", "/v1/friends/requests/player/accept", None, 204, ""),
            (
                "DELETE",
                "/v1/friends/requests/player",
                Some("{\"kind\":\"friend\"}"),
                204,
                "",
            ),
            ("GET", "/v1/friends", None, 401, "{\"error\":\"expired\"}"),
            (
                "POST",
                "/v1/friends/requests/player",
                None,
                409,
                "{\"error\":\"already_pending\"}",
            ),
            ("GET", "/v1/friends", None, 503, "unavailable"),
        ] {
            let server = Server::http("127.0.0.1:0").unwrap();
            let address = server.server_addr().to_ip().unwrap();
            let worker = std::thread::spawn(move || {
                let mut request = server
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                assert_eq!(request.method().as_str(), method);
                assert_eq!(request.url(), path);
                let header = |name: &'static str| {
                    request
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv(name))
                        .map(|h| h.value.as_str())
                };
                assert_eq!(header("Authorization"), Some("Bearer test-token"));
                assert_eq!(header("Accept"), Some("application/json"));
                assert_eq!(header("Origin"), None);
                assert_eq!(header("Cookie"), None);
                assert_eq!(header("Content-Type"), body.map(|_| "application/json"));
                let mut received = String::new();
                request.as_reader().read_to_string(&mut received).unwrap();
                assert_eq!(received, body.unwrap_or(""));
                request
                    .respond(Response::from_string(response_body).with_status_code(status))
                    .unwrap();
            });
            let response = request(
                &format!("http://{address}{path}"),
                method,
                {
                    let mut headers = vec![
                        ("Authorization".into(), "Bearer test-token".into()),
                        ("Accept".into(), "application/json".into()),
                    ];
                    if body.is_some() {
                        headers.push(("Content-Type".into(), "application/json".into()));
                    }
                    headers
                },
                body.map(|value| value.as_bytes().to_vec()),
                "error",
            )
            .await
            .unwrap();
            worker.join().unwrap();
            assert_eq!(response.status, status);
            assert_eq!(response.body, response_body.as_bytes());
        }
    }

    #[tokio::test]
    async fn generic_methods_preserve_binary_bodies_and_headers_without_ambient_credentials() {
        for method in ["GET", "HEAD", "PUT", "PATCH", "OPTIONS"] {
            let server = Server::http("127.0.0.1:0").unwrap();
            let address = server.server_addr().to_ip().unwrap();
            let body = matches!(method, "PUT" | "PATCH").then(|| vec![0, 128, 255]);
            let expected_body = body.clone();
            let worker = std::thread::spawn(move || {
                let mut request = server
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                assert_eq!(request.method().as_str(), method);
                assert_eq!(request.url(), "/new-api?q=%C3%A9&limit=5");
                let header = |name: &'static str| {
                    request
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv(name))
                        .map(|h| h.value.as_str())
                };
                assert_eq!(header("Authorization"), None);
                assert_eq!(header("Cookie"), None);
                assert_eq!(header("Origin"), None);
                assert_eq!(header("X-Custom"), Some("value"));
                let mut received = Vec::new();
                request.as_reader().read_to_end(&mut received).unwrap();
                assert_eq!(received, expected_body.unwrap_or_default());
                request
                    .respond(
                        Response::from_data(vec![255, 128, 0])
                            .with_header(tiny_http::Header::from_bytes("X-Reply", "yes").unwrap())
                            .with_header(
                                tiny_http::Header::from_bytes("Set-Cookie", "session=secret")
                                    .unwrap(),
                            ),
                    )
                    .unwrap();
            });
            let response = request(
                &format!("http://{address}/new-api?q=%C3%A9&limit=5"),
                method,
                vec![
                    ("X-Custom".into(), "value".into()),
                    ("Origin".into(), "tauri://localhost".into()),
                    ("Cookie".into(), "session=secret".into()),
                ],
                body,
                "follow",
            )
            .await
            .unwrap();
            worker.join().unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(
                response.body,
                if method == "HEAD" {
                    vec![]
                } else {
                    vec![255, 128, 0]
                }
            );
            assert!(response.headers.contains(&("x-reply".into(), "yes".into())));
            assert!(!response
                .headers
                .iter()
                .any(|(name, _)| name == "set-cookie"));
        }
    }

    #[tokio::test]
    async fn redirects_respect_policy_and_do_not_leak_bearers_to_another_origin() {
        for redirect in ["follow", "error"] {
            let source = Server::http("127.0.0.1:0").unwrap();
            let target = Server::http("127.0.0.1:0").unwrap();
            let source_url = format!("http://{}/start", source.server_addr());
            let target_url = format!("http://{}/final", target.server_addr());
            let expected_url = target_url.clone();
            let worker = std::thread::spawn(move || {
                let request = source
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                assert!(request
                    .headers()
                    .iter()
                    .any(|h| h.field.equiv("Authorization")));
                request
                    .respond(Response::empty(307).with_header(
                        tiny_http::Header::from_bytes("Location", target_url).unwrap(),
                    ))
                    .unwrap();
                let next = target.recv_timeout(Duration::from_millis(500)).unwrap();
                if redirect == "error" {
                    assert!(
                        next.is_none(),
                        "A rejected redirect must not replay the request"
                    );
                } else {
                    let next = next.unwrap();
                    assert!(!next
                        .headers()
                        .iter()
                        .any(|h| h.field.equiv("Authorization")));
                    next.respond(Response::from_string("done")).unwrap();
                }
            });
            let result = request(
                &source_url,
                if redirect == "error" { "POST" } else { "GET" },
                vec![("Authorization".into(), "Bearer private".into())],
                None,
                redirect,
            )
            .await;
            worker.join().unwrap();
            if redirect == "error" {
                assert!(result.is_err());
            } else {
                let response = result.unwrap();
                assert_eq!(response.url, expected_url);
                assert_eq!(response.body, b"done");
            }
        }
    }

    #[tokio::test]
    async fn stalled_requests_timeout() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let worker = std::thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            std::thread::sleep(Duration::from_millis(150));
            let _ = request.respond(Response::from_string("{}"));
        });
        let client = Client::builder()
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let result = request_with_client(
            &client,
            &format!("http://{address}/v1/friends"),
            "GET",
            vec![],
            None,
        )
        .await;
        worker.join().unwrap();
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("HTTP request failed"));
    }
}
