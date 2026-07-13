//! Provider-agnostic model-catalog types + candidate filtering for the CLI
//! summary providers (codex, claude-code). The CLIs are asked (with web
//! search) for their current model ids; everything here treats that output as
//! untrusted candidates. The real guarantee is the per-id validation probe in
//! `model_refresh`.

use serde::{Deserialize, Serialize};

/// One selectable model. `id` is the exact `-m`/`--model` argument.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub label: String,
}

/// What the frontend receives from the `*_list_models` commands.
#[derive(Debug, Clone, Serialize)]
pub struct ModelListPayload {
    pub models: Vec<ModelEntry>,
    /// Unix seconds of the last successful refresh; `None` if never fetched.
    pub fetched_at: Option<u64>,
    pub from_cache: bool,
}

/// Result of probing a single (possibly user-typed) model id.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationOutcome {
    pub valid: bool,
    pub error: Option<String>,
}

/// Terse [`ModelEntry`] constructor (rustfmt breaks inline struct literals).
pub fn entry(id: impl Into<String>, label: impl Into<String>) -> ModelEntry {
    ModelEntry {
        id: id.into(),
        label: label.into(),
    }
}

/// The guaranteed first entry: let the CLI / its config decide.
pub fn default_entry() -> ModelEntry {
    entry("default", "Default (CLI-configured)")
}

/// Ids that are clearly not general text/summarization models. `mini` stays —
/// small general models summarize fine and cheaply.
const SPECIAL_MARKERS: &[&str] = &[
    "review",
    "auto",
    "embed",
    "image",
    "audio",
    "whisper",
    "tts",
    "dall",
    "realtime",
    "moderation",
    "transcribe",
    "search",
];

pub fn is_special_purpose(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    SPECIAL_MARKERS.iter().any(|m| lower.contains(m))
}

/// Bound on how many candidates we validate — each probe is a real CLI call.
pub const MAX_CANDIDATES: usize = 10;

/// Trim, drop empties/`default`/specials, de-dup (case-insensitive), default
/// the label to the id, cap at [`MAX_CANDIDATES`].
pub fn sanitize_candidates(raw: Vec<ModelEntry>) -> Vec<ModelEntry> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for mut entry in raw {
        entry.id = entry.id.trim().to_string();
        entry.label = entry.label.trim().to_string();
        if entry.id.is_empty() || entry.id.eq_ignore_ascii_case("default") {
            continue;
        }
        if is_special_purpose(&entry.id) || !seen.insert(entry.id.to_ascii_lowercase()) {
            continue;
        }
        if entry.label.is_empty() {
            entry.label = entry.id.clone();
        }
        out.push(entry);
        if out.len() == MAX_CANDIDATES {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> ModelEntry {
        ModelEntry {
            id: id.into(),
            label: String::new(),
        }
    }

    #[test]
    fn sanitize_drops_specials_dupes_default_and_caps() {
        let mut raw = vec![
            entry("gpt-5.6-sol"),
            entry("GPT-5.6-SOL"),
            entry("default"),
            entry("codex-auto-review"),
            entry("gpt-image-1"),
            entry("text-embedding-3-large"),
            entry("  "),
            entry("gpt-4o-search-preview"),
        ];
        raw.extend((0..20).map(|i| entry(&format!("m{i}"))));
        let out = sanitize_candidates(raw);
        assert_eq!(out.len(), MAX_CANDIDATES);
        assert_eq!(out[0].id, "gpt-5.6-sol");
        assert_eq!(out[0].label, "gpt-5.6-sol", "label defaults to id");
        assert!(out.iter().all(|e| !is_special_purpose(&e.id)));
        assert!(!out.iter().any(|e| e.id.eq_ignore_ascii_case("default")));
    }

    #[test]
    fn keeps_mini_models() {
        assert!(!is_special_purpose("gpt-5-mini"));
        assert!(is_special_purpose("codex-auto-review"));
        assert!(is_special_purpose("gpt-4o-audio-preview"));
    }
}
