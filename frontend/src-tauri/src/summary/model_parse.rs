//! Parsing helpers + the web-augmented fetch prompt for the CLI model
//! catalogs. Pure functions; unit-tested without touching any real CLI.

use serde::Deserialize;

use super::model_catalog::ModelEntry;

/// Extract the first balanced JSON object from arbitrary model output
/// (tolerates prose, markdown fences, trailing citations).
pub fn extract_first_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let (mut depth, mut in_str, mut escaped) = (0usize, false, false);
    for (i, c) in raw[start..].char_indices() {
        match (in_str, escaped, c) {
            (true, true, _) => escaped = false,
            (true, false, '\\') => escaped = true,
            (true, false, '"') => in_str = false,
            (true, ..) => {}
            (false, _, '"') => in_str = true,
            (false, _, '{') => depth += 1,
            (false, _, '}') => {
                depth -= 1;
                if depth == 0 {
                    return Some(&raw[start..=start + i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Parse `{"models":[{"id":..,"label":..}]}` out of raw CLI output.
pub fn parse_models_json(raw: &str) -> Result<Vec<ModelEntry>, String> {
    #[derive(Deserialize)]
    struct Doc {
        models: Vec<ModelEntry>,
    }
    let obj = extract_first_json_object(raw)
        .ok_or_else(|| "model list output contained no JSON object".to_string())?;
    let doc: Doc =
        serde_json::from_str(obj).map_err(|e| format!("model list JSON invalid: {e}"))?;
    Ok(doc.models)
}

/// Pull the human-readable `"message":"…"` out of an API-error stderr blob,
/// falling back to the trimmed tail. Used to surface exact backend errors.
pub fn extract_error_message(stderr: &str) -> String {
    if let Some(pos) = stderr.rfind("\"message\":") {
        let rest = &stderr[pos + "\"message\":".len()..];
        if let Some(open) = rest.find('"') {
            let body = &rest[open + 1..];
            if let Some(close) = body.find('"') {
                let msg = body[..close].trim();
                if !msg.is_empty() {
                    return msg.to_string();
                }
            }
        }
    }
    let t = stderr.trim();
    match t.char_indices().nth_back(299) {
        Some((idx, _)) => format!("…{}", &t[idx..]),
        None => t.to_string(),
    }
}

/// The web-augmented fetch prompt, adapted per CLI. Forces at least one web
/// search (models otherwise skip the tool and answer from stale knowledge).
pub fn fetch_prompt(cli_name: &str, vendor: &str, model_flag: &str) -> String {
    format!(
        "You populate a model-picker for the {cli_name}. Search the web for the models {vendor} \
currently offers to {cli_name} subscription users as of today, and cross-check against what you \
know. You MUST run at least one web search before answering. List every model identifier accepted \
as the argument to `{model_flag}`.\n\n\
Response rules — follow EXACTLY:\n\
- Output raw JSON only. No prose, no markdown fences.\n\
- Schema: {{\"models\":[{{\"id\":\"<exact model argument string>\",\"label\":\"<short human name>\"}}]}}\n\
- List only general text/reasoning models suitable for summarizing meeting transcripts.\n\
- EXCLUDE special-purpose models (code review, auto-*, embeddings, image, audio, realtime).\n\
- Use exact id strings. Err toward completeness — a backend step verifies each id before use — \
but do not fabricate obviously fake names."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_wrapped_in_prose_and_fences() {
        let raw = "Here you go:\n```json\n{\"models\":[{\"id\":\"gpt-5.6-sol\",\"label\":\"GPT-5.6 Sol\"},{\"id\":\"gpt-5-mini\"}]}\n```\nSources: example.com";
        let models = parse_models_json(raw).expect("parses");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-5.6-sol");
        assert_eq!(models[1].label, "", "missing label tolerated");
    }

    #[test]
    fn extracts_nested_objects_and_braces_in_strings() {
        let raw = r#"note {"models":[{"id":"a{b}","label":"weird \" quote"}]} tail {"x":1}"#;
        let obj = extract_first_json_object(raw).unwrap();
        assert!(obj.starts_with("{\"models\""));
        assert!(obj.ends_with("]}"));
        assert_eq!(parse_models_json(raw).unwrap()[0].id, "a{b}");
    }

    #[test]
    fn parse_rejects_missing_or_broken_json() {
        assert!(parse_models_json("no json here").is_err());
        assert!(parse_models_json("{\"models\": oops").is_err());
    }

    #[test]
    fn error_message_extraction() {
        let stderr = r#"ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'x' model is not supported when using Codex with a ChatGPT account."}}"#;
        assert_eq!(
            extract_error_message(stderr),
            "The 'x' model is not supported when using Codex with a ChatGPT account."
        );
        assert_eq!(extract_error_message("  plain failure  "), "plain failure");
        let long = "x".repeat(400);
        let tail = extract_error_message(&long);
        assert!(tail.starts_with('…') && tail.chars().count() == 301);
    }

    #[test]
    fn prompt_forces_search_and_schema() {
        let p = fetch_prompt("Codex CLI", "OpenAI", "codex -m <MODEL>");
        assert!(p.contains("MUST run at least one web search"));
        assert!(p.contains("{\"models\":[{\"id\":"));
        assert!(p.contains("codex -m <MODEL>"));
    }
}
