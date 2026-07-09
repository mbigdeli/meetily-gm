//! Minimal Markdown → Atlassian Document Format (ADF) for Jira (doc 07 §2.2).
//!
//! Jira REST v3 requires issue descriptions as ADF JSON (a plain string is
//! rejected). v1 handles the block structure meeting summaries produce:
//! headings, paragraphs, bullet lists, and fenced code. Inline marks
//! (bold/italic) are emitted as plain text for now — add inline parsing later,
//! or use the REST v2 wiki-markup escape hatch. Pure + unit-tested.

use serde_json::{json, Value};

fn text(s: &str) -> Value {
    json!({ "type": "text", "text": s })
}

fn paragraph(s: &str) -> Value {
    json!({ "type": "paragraph", "content": [text(s)] })
}

fn heading(level: u8, s: &str) -> Value {
    json!({ "type": "heading", "attrs": { "level": level }, "content": [text(s)] })
}

fn code_block(body: &str) -> Value {
    let content = if body.is_empty() { vec![] } else { vec![text(body)] };
    json!({ "type": "codeBlock", "content": content })
}

fn heading_of(line: &str) -> Option<Value> {
    for (n, prefix) in [(3u8, "### "), (2, "## "), (1, "# ")] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return Some(heading(n, rest.trim()));
        }
    }
    None
}

fn flush_bullets(content: &mut Vec<Value>, bullets: &mut Vec<Value>) {
    if !bullets.is_empty() {
        content.push(json!({ "type": "bulletList", "content": std::mem::take(bullets) }));
    }
}

/// Convert Markdown to an ADF document value (`{type:"doc",version:1,...}`).
pub fn markdown_to_adf(md: &str) -> Value {
    let mut content: Vec<Value> = Vec::new();
    let mut bullets: Vec<Value> = Vec::new();
    let mut in_code = false;
    let mut code: Vec<String> = Vec::new();

    for line in md.lines() {
        let stripped = line.trim_start();
        if stripped.starts_with("```") {
            if in_code {
                content.push(code_block(&code.join("\n")));
                code.clear();
            } else {
                flush_bullets(&mut content, &mut bullets);
            }
            in_code = !in_code;
            continue;
        }
        if in_code {
            code.push(line.to_string());
            continue;
        }
        if let Some(rest) = stripped.strip_prefix("- ").or_else(|| stripped.strip_prefix("* ")) {
            bullets.push(json!({ "type": "listItem", "content": [paragraph(rest.trim())] }));
            continue;
        }
        flush_bullets(&mut content, &mut bullets);
        if let Some(h) = heading_of(stripped) {
            content.push(h);
        } else if !stripped.is_empty() {
            content.push(paragraph(stripped));
        }
    }
    if in_code {
        content.push(code_block(&code.join("\n")));
    }
    flush_bullets(&mut content, &mut bullets);
    json!({ "type": "doc", "version": 1, "content": content })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doc_envelope_and_blocks() {
        let adf = markdown_to_adf("# Title\n\nHello world\n\n- a\n- b");
        assert_eq!(adf["type"], "doc");
        assert_eq!(adf["version"], 1);
        let c = adf["content"].as_array().unwrap();
        assert_eq!(c[0]["type"], "heading");
        assert_eq!(c[0]["attrs"]["level"], 1);
        assert_eq!(c[1]["type"], "paragraph");
        assert_eq!(c[2]["type"], "bulletList");
        assert_eq!(c[2]["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn fenced_code_becomes_code_block() {
        let adf = markdown_to_adf("```\nlet x = 1;\n```");
        assert_eq!(adf["content"][0]["type"], "codeBlock");
        assert_eq!(adf["content"][0]["content"][0]["text"], "let x = 1;");
    }

    #[test]
    fn persian_text_preserved() {
        let adf = markdown_to_adf("خلاصه جلسه");
        assert_eq!(adf["content"][0]["content"][0]["text"], "خلاصه جلسه");
    }

    #[test]
    fn no_empty_text_nodes() {
        // Blank lines must not create invalid empty text nodes.
        let adf = markdown_to_adf("a\n\n\nb");
        let c = adf["content"].as_array().unwrap();
        assert_eq!(c.len(), 2);
        for block in c {
            assert!(!block["content"][0]["text"].as_str().unwrap().is_empty());
        }
    }
}
