//! Slack HTTP send: chat.postMessage (bot token) + incoming webhook fallback.
//! Payload comes from `slack::build_post_message`. The network call is
//! live-tested against a real workspace; the response parser is unit-tested.

use super::slack::build_post_message;
use serde_json::Value;

const POST_URL: &str = "https://slack.com/api/chat.postMessage";

/// Parse a chat.postMessage response → Ok(ts) or Err(slack error code). Pure.
fn parse_post_response(body: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("bad Slack response: {e}"))?;
    if v["ok"].as_bool() == Some(true) {
        Ok(v["ts"].as_str().unwrap_or_default().to_string())
    } else {
        Err(v["error"].as_str().unwrap_or("unknown_error").to_string())
    }
}

/// Post a recap to a channel with a bot token (`xoxb-…`). Returns the message ts.
pub async fn post_message(
    client: &reqwest::Client,
    bot_token: &str,
    channel: &str,
    title: &str,
    context: &str,
    summary_md: &str,
) -> Result<String, String> {
    let body = build_post_message(channel, title, context, summary_md);
    let resp = client
        .post(POST_URL)
        .bearer_auth(bot_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    parse_post_response(&text)
}

/// Post a recap to an incoming-webhook URL (fallback; channel is fixed by the URL).
pub async fn post_webhook(
    client: &reqwest::Client,
    webhook_url: &str,
    title: &str,
    context: &str,
    summary_md: &str,
) -> Result<(), String> {
    let body = build_post_message("", title, context, summary_md);
    let resp = client.post(webhook_url).json(&body).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Slack webhook returned HTTP {}", resp.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ok_returns_ts() {
        assert_eq!(parse_post_response(r#"{"ok":true,"ts":"1720.45"}"#).unwrap(), "1720.45");
    }

    #[test]
    fn parse_error_returns_code() {
        assert_eq!(
            parse_post_response(r#"{"ok":false,"error":"channel_not_found"}"#).unwrap_err(),
            "channel_not_found"
        );
    }

    #[test]
    fn parse_garbage_is_error() {
        assert!(parse_post_response("not json").is_err());
    }
}
