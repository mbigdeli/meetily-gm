//! Loopback listener that catches the OAuth redirect bounced from the static
//! callback page, plus pure request-parsing helpers.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Bind an ephemeral loopback port. Returns (listener, port).
pub async fn bind_loopback() -> Result<(TcpListener, u16), String> {
    let l = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    Ok((l, port))
}

/// Extract the query string from a raw HTTP request's first line.
pub fn request_query(raw: &str) -> Option<String> {
    let line = raw.lines().next()?;
    let target = line.split_whitespace().nth(1)?; // GET <target> HTTP/1.1
    let (_, q) = target.split_once('?')?;
    Some(q.to_string())
}

/// Read one query field, url-decoded.
pub fn field(query: &str, key: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}

const DONE_HTML: &str = "<!doctype html><html><body style=\"font-family:system-ui;text-align:center;margin-top:4rem\"><h2>&#9989; Miting is connected to Slack</h2><p>You can close this tab and return to Miting.</p></body></html>";

/// Wait for the browser to hit the loopback with ?code=&state=, validate the
/// state, and return the authorization code. Serves a friendly close-tab page.
pub async fn wait_for_code(
    listener: TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, String> {
    let accept = async {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            let raw = String::from_utf8_lossy(&buf[..n]);
            let query = match request_query(&raw) {
                Some(q) => q,
                None => continue, // favicon or noise; keep waiting
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                DONE_HTML.len(),
                DONE_HTML
            );
            let _ = sock.write_all(resp.as_bytes()).await;
            let _ = sock.flush().await;
            if field(&query, "state").as_deref() != Some(expected_state) {
                return Err("Slack sign-in state mismatch — please try again.".to_string());
            }
            return field(&query, "code")
                .ok_or_else(|| "Slack did not return an authorization code.".to_string());
        }
    };
    tokio::time::timeout(timeout, accept)
        .await
        .map_err(|_| "Timed out waiting for Slack approval.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_and_state_from_request() {
        let raw = "GET /cb?code=abc123&state=42.nonce HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let q = request_query(raw).unwrap();
        assert_eq!(field(&q, "code").as_deref(), Some("abc123"));
        assert_eq!(field(&q, "state").as_deref(), Some("42.nonce"));
    }

    #[test]
    fn no_query_returns_none() {
        assert!(request_query("GET /favicon.ico HTTP/1.1\r\n").is_none());
    }

    #[test]
    fn urldecodes_values() {
        let q = "code=a%2Bb&state=1.x";
        assert_eq!(field(q, "code").as_deref(), Some("a+b"));
    }
}
