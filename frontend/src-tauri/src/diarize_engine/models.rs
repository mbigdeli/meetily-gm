//! Diarization model catalog: pyannote segmentation + a speaker-embedding
//! model, both ONNX (run through the same `ort` runtime as the Parakeet
//! engine). Downloaded on demand into the app models dir by a later increment,
//! mirroring the Parakeet model flow.
//!
//! NOTE: exact release-asset URLs are pinned + verified by the download
//! increment (doc 18, increment 2); the segmentation entry currently points at
//! the sherpa-onnx archive it ships in.

/// A diarization ONNX model file to fetch and load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiarizationModel {
    /// Stable id used in settings + the on-disk subdirectory.
    pub id: &'static str,
    /// File name on disk once extracted.
    pub filename: &'static str,
    /// Download source (sherpa-onnx release assets — ONNX, no PyTorch).
    pub url: &'static str,
    /// Approximate download size in MiB (UI progress + a validation floor).
    pub size_mb: u32,
}

/// pyannote segmentation-3.0 exported to ONNX (per-frame, per-speaker speech
/// activity). Redistributed as a sherpa-onnx release archive.
pub const SEGMENTATION: DiarizationModel = DiarizationModel {
    id: "pyannote-segmentation-3.0",
    filename: "segmentation.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    size_mb: 6,
};

/// 3D-Speaker CAM++ speaker-embedding model (ONNX, 16 kHz). The multilingual
/// "advanced" variant — speaker embeddings are acoustic (language-agnostic), so
/// it discriminates Persian/mixed voices fine.
///
/// NOTE: the upstream release tag is genuinely misspelled `speaker-recongition-
/// models` (not "recognition"); the URL must keep the typo or the download 404s.
pub const EMBEDDING: DiarizationModel = DiarizationModel {
    id: "3dspeaker-campplus-advanced",
    filename: "campplus.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    size_mb: 28,
};

/// Every model the diarization pipeline needs present before it can run.
pub const REQUIRED: [DiarizationModel; 2] = [SEGMENTATION, EMBEDDING];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_models_have_distinct_ids() {
        assert_ne!(SEGMENTATION.id, EMBEDDING.id);
        assert_eq!(REQUIRED.len(), 2);
    }

    #[test]
    fn every_model_has_https_source_and_nonzero_size() {
        for m in REQUIRED {
            assert!(m.url.starts_with("https://"), "{} url must be https", m.id);
            assert!(!m.filename.is_empty());
            assert!(m.size_mb > 0);
        }
    }

    #[test]
    fn embedding_url_keeps_the_upstream_misspelled_tag() {
        // The sherpa-onnx release tag is literally "speaker-recongition-models".
        // "Correcting" it to "recognition" 404s the download — guard it.
        assert!(EMBEDDING.url.contains("speaker-recongition-models"));
    }
}
