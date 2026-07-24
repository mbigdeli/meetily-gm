//! Powerset decoding for pyannote segmentation-3.0.
//!
//! The segmentation model does NOT emit one probability per speaker; it emits
//! one probability per *powerset class* — every allowed subset of speakers that
//! can be simultaneously active (∅, each single speaker, each pair, …). This
//! decodes the per-frame argmax class back into per-speaker binary activity.
//!
//! Class order matches pyannote's `Powerset`: ascending subset size, then
//! lexicographic within a size — e.g. for 3 speakers / max 2 simultaneous:
//! `[{}, {0}, {1}, {2}, {0,1}, {0,2}, {1,2}]` (7 classes). Pure logic, no ONNX.

/// Build the ordered class→speaker-subset table (pyannote ordering).
#[must_use]
pub fn powerset(num_speakers: usize, max_simultaneous: usize) -> Vec<Vec<usize>> {
    let mut classes = Vec::new();
    for size in 0..=max_simultaneous {
        push_combinations(num_speakers, size, &mut classes);
    }
    classes
}

/// Append every size-`k` combination of `0..n` in lexicographic order.
fn push_combinations(n: usize, k: usize, out: &mut Vec<Vec<usize>>) {
    let mut combo: Vec<usize> = (0..k).collect();
    if k == 0 {
        out.push(Vec::new());
        return;
    }
    if k > n {
        return;
    }
    loop {
        out.push(combo.clone());
        // Advance to the next lexicographic combination.
        let mut i = k;
        while i > 0 {
            i -= 1;
            if combo[i] != i + n - k {
                combo[i] += 1;
                for j in i + 1..k {
                    combo[j] = combo[j - 1] + 1;
                }
                break;
            }
            if i == 0 {
                return;
            }
        }
    }
}

/// Index of the highest-scoring class in one frame's logits/probabilities.
#[must_use]
pub fn argmax(frame: &[f32]) -> usize {
    frame
        .iter()
        .enumerate()
        .fold(
            (0usize, f32::MIN),
            |(bi, bv), (i, &v)| {
                if v > bv {
                    (i, v)
                } else {
                    (bi, bv)
                }
            },
        )
        .0
}

/// Decode per-frame class scores into per-frame, per-speaker activity flags.
/// `frames[f]` is the class-score vector for frame `f`; the returned
/// `out[f][s]` is true when speaker `s` is active in frame `f`.
#[must_use]
pub fn decode_activity(
    frames: &[Vec<f32>],
    num_speakers: usize,
    max_simultaneous: usize,
) -> Vec<Vec<bool>> {
    let table = powerset(num_speakers, max_simultaneous);
    frames
        .iter()
        .map(|frame| {
            let mut active = vec![false; num_speakers];
            if let Some(subset) = table.get(argmax(frame)) {
                for &s in subset {
                    if s < num_speakers {
                        active[s] = true;
                    }
                }
            }
            active
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powerset_3_2_matches_pyannote_order() {
        let p = powerset(3, 2);
        assert_eq!(
            p,
            vec![
                vec![],
                vec![0],
                vec![1],
                vec![2],
                vec![0, 1],
                vec![0, 2],
                vec![1, 2],
            ]
        );
    }

    #[test]
    fn empty_class_means_silence() {
        let frames = vec![vec![9.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]];
        assert_eq!(
            decode_activity(&frames, 3, 2),
            vec![vec![false, false, false]]
        );
    }

    #[test]
    fn singleton_class_activates_one_speaker() {
        // argmax at index 2 → {1}.
        let frames = vec![vec![0.0, 0.1, 5.0, 0.0, 0.0, 0.0, 0.0]];
        assert_eq!(
            decode_activity(&frames, 3, 2),
            vec![vec![false, true, false]]
        );
    }

    #[test]
    fn pair_class_activates_two_speakers() {
        // argmax at index 4 → {0,1} (first pair).
        let frames = vec![vec![0.0, 0.0, 0.0, 0.0, 7.0, 0.0, 0.0]];
        assert_eq!(
            decode_activity(&frames, 3, 2),
            vec![vec![true, true, false]]
        );
    }

    #[test]
    fn argmax_breaks_ties_to_first() {
        assert_eq!(argmax(&[1.0, 1.0, 0.5]), 0);
    }
}
