//! Best-effort structured transcript cleanup after a recording is saved.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing::info;

use crate::summary::configured::generate_with_configured;
use crate::summary::transcript_enhancement_chunks::{parse_enhanced_response, segment_batches};

const SYSTEM_PROMPT: &str = r#"This is a meeting transcript. Improve any parts that contain transcription errors.

Use the context of the entire conversation to understand the intended words and rewrite unclear, broken, or unnatural phrases into fluent text. Keep the original language and meaning; do not translate or summarize.

The input is JSON. Return the same segments in the same order and keep their index and timing fields unchanged. Edit the text fields as freely as needed to produce the best corrected transcript. Return only the JSON."#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct EnhancementSegment {
    pub index: usize,
    pub text: String,
    pub timestamp: String,
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Serialize)]
struct SegmentPayload<'a> {
    segments: &'a [EnhancementSegment],
}

pub(crate) async fn enhance_saved_transcript(
    pool: &SqlitePool,
    app_data_dir: Option<&PathBuf>,
    segments: &[EnhancementSegment],
) -> Result<Option<Vec<String>>, String> {
    if segments.is_empty() {
        return Ok(None);
    }

    let mut texts = Vec::with_capacity(segments.len());
    for batch in segment_batches(segments) {
        let prompt = serde_json::to_string(&SegmentPayload { segments: batch })
            .map_err(|e| format!("serialize transcript enhancement input: {e}"))?;
        let raw = match generate_with_configured(pool, app_data_dir, SYSTEM_PROMPT, &prompt).await {
            Ok(value) => value,
            Err(error) if error == "no_ai_configured" => return Ok(None),
            Err(error) => return Err(error),
        };
        texts.extend(parse_enhanced_response(batch, &raw)?);
    }

    info!(
        "Transcript enhancement accepted for {} segment(s)",
        texts.len()
    );
    Ok(Some(texts))
}
