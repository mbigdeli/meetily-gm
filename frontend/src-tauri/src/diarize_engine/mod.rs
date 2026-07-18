//! Acoustic speaker diarization (local, ONNX via `ort`) — labels *who spoke
//! when* from the recording audio alone, for meetings without Google Meet
//! captions. Design + rollout: `docs/product-plan/18-acoustic-diarization.md`.
//!
//! This first increment lands the pure, model-independent core (clustering +
//! turn building + transcript labelling) with full unit tests, plus the model
//! catalog. Segmentation / embedding ONNX inference, model download, the
//! recording-finalize hook, and the DB writer are subsequent increments — they
//! need the model files and a real multi-speaker recording to verify quality.

pub mod clustering;
pub mod models;
pub mod turns;

pub use turns::{merge_turns, speaker_for, speaker_name, SpeakerTurn};

/// Default average-linkage cosine-distance merge threshold. Conservative so
/// distinct voices stay apart; tuned against real recordings in increment 2.
pub const DEFAULT_CLUSTER_THRESHOLD: f32 = 0.55;

/// Max gap (seconds) bridged when merging same-speaker windows into one turn.
pub const DEFAULT_TURN_GAP_SECONDS: f64 = 0.5;

/// The ONNX models' native audio rate: 16 kHz mono (pyannote + CAM++).
pub const TARGET_SAMPLE_RATE: u32 = 16_000;

/// A transcript segment tagged with an acoustic speaker label — the unit the
/// DB writer (increment 2) will persist into `meeting_diarized_segments`.
#[derive(Debug, Clone, PartialEq)]
pub struct DiarizedSegment {
    pub start: f64,
    pub end: f64,
    pub speaker_name: String,
    pub text: String,
}

/// Tag each `(start, end, text)` transcript segment with the speaker of the
/// turn it most overlaps. Segments overlapping no turn fall back to
/// `Speaker 1` (a single-speaker recording still reads sensibly).
#[must_use]
pub fn label_transcript(
    turns: &[SpeakerTurn],
    segments: &[(f64, f64, String)],
) -> Vec<DiarizedSegment> {
    segments
        .iter()
        .map(|(start, end, text)| {
            let speaker = speaker_for(turns, *start, *end).unwrap_or(0);
            DiarizedSegment {
                start: *start,
                end: *end,
                speaker_name: speaker_name(speaker),
                text: text.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_segments_by_overlapping_turn() {
        let turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 2.0,
                speaker: 0,
            },
            SpeakerTurn {
                start: 2.0,
                end: 5.0,
                speaker: 1,
            },
        ];
        let segs = vec![
            (0.0, 1.8, "hello".to_string()),
            (2.1, 4.0, "world".to_string()),
        ];
        let out = label_transcript(&turns, &segs);
        assert_eq!(out[0].speaker_name, "Speaker 1");
        assert_eq!(out[1].speaker_name, "Speaker 2");
        assert_eq!(out[1].text, "world");
    }

    #[test]
    fn segment_without_a_turn_defaults_to_speaker_one() {
        let out = label_transcript(&[], &[(0.0, 1.0, "hi".to_string())]);
        assert_eq!(out[0].speaker_name, "Speaker 1");
    }
}
