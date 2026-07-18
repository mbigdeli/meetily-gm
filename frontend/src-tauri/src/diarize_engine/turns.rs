//! Build speaker turns from per-window labels and map them onto transcript
//! segments. Pure logic (no ONNX, no DB).

/// A contiguous span attributed to one speaker (seconds from recording start).
#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerTurn {
    pub start: f64,
    pub end: f64,
    pub speaker: usize,
}

/// Merge time-ordered `(start, end, label)` windows into speaker turns, joining
/// consecutive windows of the same speaker separated by at most `gap` seconds.
/// Windows are assumed sorted by `start` (segmentation emits them in order).
#[must_use]
pub fn merge_turns(windows: &[(f64, f64, usize)], gap: f64) -> Vec<SpeakerTurn> {
    let mut turns: Vec<SpeakerTurn> = Vec::new();
    for &(start, end, speaker) in windows {
        match turns.last_mut() {
            Some(t) if t.speaker == speaker && start - t.end <= gap => {
                if end > t.end {
                    t.end = end;
                }
            }
            _ => turns.push(SpeakerTurn {
                start,
                end,
                speaker,
            }),
        }
    }
    turns
}

/// Speaker label of the turn with the greatest overlap with `[start, end)`, or
/// `None` when no turn overlaps. Ties keep the earlier (already-seen) turn.
#[must_use]
pub fn speaker_for(turns: &[SpeakerTurn], start: f64, end: f64) -> Option<usize> {
    let mut best: Option<(f64, usize)> = None;
    for t in turns {
        let overlap = end.min(t.end) - start.max(t.start);
        if overlap <= 0.0 {
            continue;
        }
        if best.map_or(true, |(o, _)| overlap > o) {
            best = Some((overlap, t.speaker));
        }
    }
    best.map(|(_, s)| s)
}

/// Human label for a 0-based speaker index: `Speaker 1`, `Speaker 2`, …
#[must_use]
pub fn speaker_name(index: usize) -> String {
    format!("Speaker {}", index + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_same_speaker_across_small_gap() {
        let w = [(0.0, 1.0, 0), (1.2, 2.0, 0)];
        assert_eq!(
            merge_turns(&w, 0.5),
            vec![SpeakerTurn {
                start: 0.0,
                end: 2.0,
                speaker: 0
            }]
        );
    }

    #[test]
    fn splits_on_speaker_change() {
        let w = [(0.0, 1.0, 0), (1.0, 2.0, 1)];
        let turns = merge_turns(&w, 0.5);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[1].speaker, 1);
    }

    #[test]
    fn splits_same_speaker_across_large_gap() {
        let w = [(0.0, 1.0, 0), (5.0, 6.0, 0)];
        assert_eq!(merge_turns(&w, 0.5).len(), 2);
    }

    #[test]
    fn speaker_for_picks_max_overlap() {
        let turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 2.0,
                speaker: 0,
            },
            SpeakerTurn {
                start: 2.0,
                end: 6.0,
                speaker: 1,
            },
        ];
        // [1.5, 4.0): 0.5s with speaker0, 2.0s with speaker1 → speaker1.
        assert_eq!(speaker_for(&turns, 1.5, 4.0), Some(1));
    }

    #[test]
    fn speaker_for_returns_none_without_overlap() {
        let turns = vec![SpeakerTurn {
            start: 0.0,
            end: 1.0,
            speaker: 0,
        }];
        assert_eq!(speaker_for(&turns, 5.0, 6.0), None);
    }

    #[test]
    fn speaker_name_is_one_based() {
        assert_eq!(speaker_name(0), "Speaker 1");
        assert_eq!(speaker_name(3), "Speaker 4");
    }
}
