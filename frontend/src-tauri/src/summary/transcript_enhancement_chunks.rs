use serde::Deserialize;

use crate::summary::processor::clean_llm_markdown_output;
use crate::summary::transcript_enhancement::EnhancementSegment;

const MAX_BATCH_CHARS: usize = 6_000;
const MAX_BATCH_SEGMENTS: usize = 40;

#[derive(Deserialize)]
struct EnhancedPayload {
    segments: Vec<EnhancementSegment>,
}

pub(super) fn segment_batches(segments: &[EnhancementSegment]) -> Vec<&[EnhancementSegment]> {
    let mut batches = Vec::new();
    let mut start = 0;
    while start < segments.len() {
        let mut end = start;
        let mut chars = 0;
        while end < segments.len() && end - start < MAX_BATCH_SEGMENTS {
            let next = segments[end].text.chars().count();
            if end > start && chars + next > MAX_BATCH_CHARS {
                break;
            }
            chars += next;
            end += 1;
        }
        batches.push(&segments[start..end]);
        start = end;
    }
    batches
}

pub(super) fn parse_enhanced_response(
    originals: &[EnhancementSegment],
    raw: &str,
) -> Result<Vec<String>, String> {
    let cleaned = clean_llm_markdown_output(raw);
    let start = cleaned
        .find('{')
        .ok_or_else(|| "enhancement response did not contain JSON".to_string())?;
    let end = cleaned
        .rfind('}')
        .ok_or_else(|| "enhancement response had incomplete JSON".to_string())?;
    let payload: EnhancedPayload = serde_json::from_str(&cleaned[start..=end])
        .map_err(|e| format!("parse transcript enhancement response: {e}"))?;

    if payload.segments.len() != originals.len() {
        return Err("enhancement changed the segment count".into());
    }
    for (original, enhanced) in originals.iter().zip(&payload.segments) {
        if !metadata_matches(original, enhanced) {
            return Err("enhancement changed transcript timing metadata".into());
        }
        if !original.text.trim().is_empty() && enhanced.text.trim().is_empty() {
            return Err("enhancement removed segment text".into());
        }
    }

    let before: usize = originals.iter().map(|s| s.text.chars().count()).sum();
    let after: usize = payload
        .segments
        .iter()
        .map(|s| s.text.chars().count())
        .sum();
    if after < before.saturating_mul(2) / 5 || after > before.saturating_mul(9) / 5 + 50 {
        return Err("enhancement changed too much text".into());
    }
    Ok(payload.segments.into_iter().map(|s| s.text).collect())
}

fn metadata_matches(left: &EnhancementSegment, right: &EnhancementSegment) -> bool {
    left.index == right.index
        && left.timestamp == right.timestamp
        && left.audio_start_time == right.audio_start_time
        && left.audio_end_time == right.audio_end_time
        && left.duration == right.duration
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(index: usize, text: &str) -> EnhancementSegment {
        EnhancementSegment {
            index,
            text: text.into(),
            timestamp: format!("00:0{index}"),
            audio_start_time: Some(index as f64),
            audio_end_time: Some(index as f64 + 1.0),
            duration: Some(1.0),
        }
    }

    #[test]
    fn accepts_text_only_changes_and_preserves_order() {
        let originals = vec![segment(0, "hello wrld"), segment(1, "next sentnce")];
        let mut improved = originals.clone();
        improved[0].text = "Hello world.".into();
        improved[1].text = "Next sentence.".into();
        let raw = serde_json::json!({ "segments": improved }).to_string();
        assert_eq!(
            parse_enhanced_response(&originals, &raw).unwrap(),
            vec!["Hello world.", "Next sentence."]
        );
    }

    #[test]
    fn accepts_a_larger_contextual_rewrite() {
        let originals = vec![segment(0, "bad words")];
        let mut improved = originals.clone();
        improved[0].text = "A natural sentence reconstructed from context.".into();
        let raw = serde_json::json!({ "segments": improved }).to_string();
        assert_eq!(
            parse_enhanced_response(&originals, &raw).unwrap(),
            vec!["A natural sentence reconstructed from context."]
        );
    }

    #[test]
    fn rejects_timing_or_count_changes() {
        let originals = vec![segment(0, "hello")];
        let mut changed = originals.clone();
        changed[0].audio_start_time = Some(9.0);
        let raw = serde_json::json!({ "segments": changed }).to_string();
        assert!(parse_enhanced_response(&originals, &raw).is_err());
        let raw = serde_json::json!({ "segments": [] }).to_string();
        assert!(parse_enhanced_response(&originals, &raw).is_err());
    }

    #[test]
    fn batches_without_splitting_segments() {
        let segments = (0..45).map(|i| segment(i, "text")).collect::<Vec<_>>();
        let batches = segment_batches(&segments);
        assert_eq!(batches.iter().map(|b| b.len()).sum::<usize>(), 45);
        assert_eq!(batches.len(), 2);
    }
}
