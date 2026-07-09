//! Markdown → Slack mrkdwn + a meeting-recap Block Kit builder (doc 08 §5).
//!
//! Slack mrkdwn ≠ Markdown: `*bold*` (single asterisk), `_italic_`, no headings
//! (a heading becomes a bold line). Section text caps at 3,000 chars; a message
//! caps at 50 blocks. Pure + unit-tested; the HTTP client builds on this.

use serde_json::{json, Value};

/// Slack `section` text hard limit.
pub const SECTION_LIMIT: usize = 2900; // a little under 3000 for safety

/// Convert Markdown to Slack mrkdwn (line-oriented; good enough for summaries).
pub fn to_mrkdwn(md: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for line in md.lines() {
        let s = line.trim_end();
        let stripped = s.trim_start();
        // Headings → bold line.
        if let Some(rest) = heading_body(stripped) {
            out.push(format!("*{}*", rest));
            continue;
        }
        // Bullets: normalize "- "/"* " to "• ".
        if let Some(rest) = stripped.strip_prefix("- ").or_else(|| stripped.strip_prefix("* ")) {
            out.push(format!("• {}", bold(rest)));
            continue;
        }
        out.push(bold(s));
    }
    out.join("\n")
}

fn heading_body(line: &str) -> Option<&str> {
    for p in ["### ", "## ", "# "] {
        if let Some(rest) = line.strip_prefix(p) {
            return Some(rest.trim());
        }
    }
    None
}

/// Markdown `**bold**` → Slack `*bold*`. Only when the `**` markers are
/// balanced; otherwise leave the text untouched (don't mangle `2 ** 3`).
/// Italic left as-is (`_` is usually literal in meeting text / file names).
fn bold(s: &str) -> String {
    if s.matches("**").count() % 2 == 0 {
        s.replace("**", "*")
    } else {
        s.to_string()
    }
}

fn truncate(s: &str, limit: usize) -> String {
    if s.chars().count() <= limit {
        return s.to_string();
    }
    let mut t: String = s.chars().take(limit.saturating_sub(1)).collect();
    t.push('…');
    t
}

/// Build a Block Kit recap message. `text` is the notification fallback.
pub fn recap_blocks(title: &str, context: &str, summary_md: &str) -> Value {
    let summary = truncate(&to_mrkdwn(summary_md), SECTION_LIMIT);
    json!({
        "text": title,
        "blocks": [
            { "type": "header", "text": { "type": "plain_text", "text": truncate(title, 150) } },
            { "type": "context", "elements": [ { "type": "mrkdwn", "text": context } ] },
            { "type": "section", "text": { "type": "mrkdwn", "text": summary } }
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_to_bold_and_bullets() {
        assert_eq!(to_mrkdwn("## Decisions"), "*Decisions*");
        assert_eq!(to_mrkdwn("- ship it"), "• ship it");
    }

    #[test]
    fn double_asterisk_bold_to_single() {
        assert_eq!(to_mrkdwn("do **this** now"), "do *this* now");
    }

    #[test]
    fn unbalanced_bold_left_intact() {
        assert_eq!(to_mrkdwn("2 ** 3 = 8"), "2 ** 3 = 8");
    }

    #[test]
    fn recap_has_fallback_and_blocks() {
        let v = recap_blocks("Q3 sync", "45 min · 6 people", "# Summary\n- a");
        assert_eq!(v["text"], "Q3 sync");
        let blocks = v["blocks"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "header");
        assert_eq!(blocks[2]["text"]["text"], "*Summary*\n• a");
    }
}
