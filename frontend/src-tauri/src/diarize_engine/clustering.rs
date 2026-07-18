//! Agglomerative speaker clustering over embedding vectors.
//!
//! Pure logic (no ONNX): groups per-window speaker embeddings into speakers by
//! average-linkage agglomerative clustering on cosine distance, stopping when
//! the closest remaining pair exceeds `threshold` — unless that would leave
//! more clusters than `max_speakers` (0 = no cap), in which case merging
//! continues. Deterministic: ties break to the lowest index and output labels
//! are ordered by each cluster's earliest member.

/// Cosine distance in `[0, 2]`: 0 = same direction, 1 = orthogonal. A
/// zero-magnitude vector is treated as maximally distant (1.0).
fn cosine_distance(a: &[f32], b: &[f32]) -> f32 {
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 1.0;
    }
    1.0 - dot / (na.sqrt() * nb.sqrt())
}

/// Mean pairwise cosine distance between two clusters' members.
fn avg_linkage(a: &[usize], b: &[usize], emb: &[Vec<f32>]) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0.0f32;
    for &i in a {
        for &j in b {
            sum += cosine_distance(&emb[i], &emb[j]);
            count += 1.0;
        }
    }
    if count == 0.0 {
        1.0
    } else {
        sum / count
    }
}

/// Cluster `embeddings` into contiguous 0-based speaker labels (one per input).
#[must_use]
pub fn cluster(embeddings: &[Vec<f32>], threshold: f32, max_speakers: usize) -> Vec<usize> {
    let n = embeddings.len();
    if n == 0 {
        return Vec::new();
    }
    let mut clusters: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();

    while clusters.len() > 1 {
        let (mut bi, mut bj, mut best) = (0usize, 1usize, f32::MAX);
        for i in 0..clusters.len() {
            for j in (i + 1)..clusters.len() {
                let d = avg_linkage(&clusters[i], &clusters[j], embeddings);
                if d < best {
                    best = d;
                    bi = i;
                    bj = j;
                }
            }
        }
        let over_cap = max_speakers != 0 && clusters.len() > max_speakers;
        if best > threshold && !over_cap {
            break;
        }
        let merged = clusters.remove(bj);
        clusters[bi].extend(merged);
    }

    labels_by_first_appearance(&clusters, n)
}

/// Assign labels so the cluster whose earliest member appears first is speaker 0.
fn labels_by_first_appearance(clusters: &[Vec<usize>], n: usize) -> Vec<usize> {
    let mut order: Vec<(usize, usize)> = clusters
        .iter()
        .enumerate()
        .map(|(idx, c)| (c.iter().copied().min().unwrap_or(0), idx))
        .collect();
    order.sort_unstable();
    let mut labels = vec![0usize; n];
    for (label, (_, cluster_idx)) in order.into_iter().enumerate() {
        for &point in &clusters[cluster_idx] {
            labels[point] = label;
        }
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_yields_no_labels() {
        assert!(cluster(&[], 0.5, 0).is_empty());
    }

    #[test]
    fn single_embedding_is_speaker_zero() {
        assert_eq!(cluster(&[vec![1.0, 0.0]], 0.5, 0), vec![0]);
    }

    #[test]
    fn identical_vectors_merge() {
        let e = vec![vec![1.0, 0.0], vec![1.0, 0.0]];
        assert_eq!(cluster(&e, 0.5, 0), vec![0, 0]);
    }

    #[test]
    fn orthogonal_vectors_split() {
        let e = vec![vec![1.0, 0.0], vec![0.0, 1.0]];
        assert_eq!(cluster(&e, 0.5, 0), vec![0, 1]);
    }

    #[test]
    fn labels_follow_first_appearance_order() {
        // point0 & point2 are one voice, point1 another → labels 0,1,0.
        let e = vec![vec![1.0, 0.0], vec![0.0, 1.0], vec![1.0, 0.0]];
        assert_eq!(cluster(&e, 0.5, 0), vec![0, 1, 0]);
    }

    #[test]
    fn max_speakers_cap_forces_merge_of_distant_voices() {
        let e = vec![vec![1.0, 0.0], vec![0.0, 1.0], vec![-1.0, 0.0]];
        // Without a cap these are 3 speakers; capped at 2 the closest pair merges.
        let labels = cluster(&e, 0.5, 2);
        let distinct: std::collections::BTreeSet<_> = labels.iter().collect();
        assert_eq!(distinct.len(), 2);
    }
}
