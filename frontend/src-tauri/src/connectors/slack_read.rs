//! Slack read/search (acts as the connected account). A user token (xoxp-…)
//! unlocks search + full history as you; a bot token can list/read channels it
//! is in. Network calls are live-tested; response parsers are unit-tested.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize, PartialEq)]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct SlackMessage {
    pub text: String,
    pub ts: String,
    pub channel: String,
    pub permalink: Option<String>,
}

fn ok_or_err(v: &Value) -> Result<(), String> {
    if v["ok"].as_bool() == Some(true) {
        Ok(())
    } else {
        Err(v["error"].as_str().unwrap_or("slack_error").to_string())
    }
}

fn parse_channels(body: &str) -> Result<Vec<SlackChannel>, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    ok_or_err(&v)?;
    Ok(v["channels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    Some(SlackChannel {
                        id: c["id"].as_str()?.to_string(),
                        name: c["name"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

fn parse_search(body: &str) -> Result<Vec<SlackMessage>, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    ok_or_err(&v)?;
    Ok(v["messages"]["matches"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| SlackMessage {
                    text: m["text"].as_str().unwrap_or("").to_string(),
                    ts: m["ts"].as_str().unwrap_or("").to_string(),
                    channel: m["channel"]["name"].as_str().unwrap_or("").to_string(),
                    permalink: m["permalink"].as_str().map(String::from),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// List channels the token can see (public + private). Works with a bot or user
/// token that has channels:read / groups:read.
pub async fn list_channels(client: &reqwest::Client, token: &str) -> Result<Vec<SlackChannel>, String> {
    let resp = client
        .get("https://slack.com/api/conversations.list")
        .bearer_auth(token)
        .query(&[
            ("types", "public_channel,private_channel"),
            ("exclude_archived", "true"),
            ("limit", "200"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    parse_channels(&resp.text().await.map_err(|e| e.to_string())?)
}

/// Search messages as the user (requires a user token with search:read).
pub async fn search_messages(
    client: &reqwest::Client,
    user_token: &str,
    query: &str,
) -> Result<Vec<SlackMessage>, String> {
    let resp = client
        .get("https://slack.com/api/search.messages")
        .bearer_auth(user_token)
        .query(&[("query", query), ("count", "20")])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    parse_search(&resp.text().await.map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_parse_ok() {
        let ch = parse_channels(r#"{"ok":true,"channels":[{"id":"C1","name":"product"},{"id":"C2","name":"design"}]}"#).unwrap();
        assert_eq!(ch.len(), 2);
        assert_eq!(ch[0], SlackChannel { id: "C1".into(), name: "product".into() });
    }

    #[test]
    fn channels_parse_error() {
        assert_eq!(parse_channels(r#"{"ok":false,"error":"invalid_auth"}"#).unwrap_err(), "invalid_auth");
    }

    #[test]
    fn search_parse_matches() {
        let m = parse_search(r#"{"ok":true,"messages":{"matches":[{"text":"pricing decided","ts":"1.2","channel":{"name":"product"},"permalink":"http://x"}]}}"#).unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].channel, "product");
        assert_eq!(m[0].permalink.as_deref(), Some("http://x"));
    }
}
