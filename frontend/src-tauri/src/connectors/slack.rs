//! Slack `chat.postMessage` payload builder (doc 08 §5). Pure — the HTTP send
//! (bot token or webhook) is a separate layer, live-tested against a real
//! workspace. Uses the Block Kit recap builder.

use super::mrkdwn::recap_blocks;
use serde_json::{json, Value};

/// Build a `chat.postMessage` body: the recap blocks addressed to a channel.
/// `text` is the notification fallback (also required by webhooks).
pub fn build_post_message(channel: &str, title: &str, context: &str, summary_md: &str) -> Value {
    let recap = recap_blocks(title, context, summary_md);
    json!({
        "channel": channel,
        "text": recap["text"].clone(),
        "blocks": recap["blocks"].clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_channel_with_fallback_and_blocks() {
        let body = build_post_message("C123", "Q3 sync", "45 min · 6 people", "# Summary\n- a");
        assert_eq!(body["channel"], "C123");
        assert_eq!(body["text"], "Q3 sync"); // fallback text
        let blocks = body["blocks"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "header");
        assert!(blocks.len() >= 3);
    }
}
