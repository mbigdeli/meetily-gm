use super::catalog::{file_url, spec, MODELS};
use super::ShenavaEngine;

#[test]
fn catalog_has_three_pinned_non_commercial_models() {
    assert_eq!(MODELS.len(), 3);
    for model in MODELS {
        assert!(file_url(&model, "model.onnx").contains(&format!("/resolve/{}/", model.revision)));
        assert!(!file_url(&model, "model.onnx").contains("/resolve/main/"));
        assert!(model.model_bytes > 0);
        assert_eq!(model.sha256.len(), 64);
    }
}

#[test]
fn catalog_uses_stable_application_model_names() {
    for name in [
        "shenava-koochik-v1.0",
        "shenava-rizeh-v1.0",
        "shenava-rizeh-pizeh-v1.0",
    ] {
        assert_eq!(spec(name).map(|model| model.name), Some(name));
    }
}

#[tokio::test]
async fn fresh_models_directory_reports_all_models_missing() {
    let temporary_directory = tempfile::tempdir().expect("temporary directory");
    let engine = ShenavaEngine::new(temporary_directory.path().to_path_buf())
        .expect("create Shenava engine");
    let statuses = engine.discover_models().await;

    assert_eq!(statuses.len(), 3);
    assert!(statuses
        .iter()
        .all(|model| model.status == super::ModelStatus::Missing));
    assert!(statuses.iter().all(|model| model.license == "CC-BY-NC-4.0"));
}

#[tokio::test]
#[ignore = "requires SHENAVA_SMOKE_MODELS_DIR and SHENAVA_SMOKE_WAV"]
async fn downloaded_model_transcribes_real_audio() {
    let models_dir = std::env::var("SHENAVA_SMOKE_MODELS_DIR")
        .expect("SHENAVA_SMOKE_MODELS_DIR must point to the app models directory");
    let wav_path =
        std::env::var("SHENAVA_SMOKE_WAV").expect("SHENAVA_SMOKE_WAV must point to a 16 kHz WAV");
    let model = std::env::var("SHENAVA_SMOKE_MODEL")
        .unwrap_or_else(|_| "shenava-koochik-v1.0".to_string());
    let decoded = crate::audio::decoder::decode_audio_file(std::path::Path::new(&wav_path))
        .expect("decode smoke-test WAV");
    let samples = decoded.to_whisper_format();
    let engine = ShenavaEngine::new(models_dir.into()).expect("create Shenava engine");

    engine.load_model(&model).await.expect("load Shenava model");
    let transcript = engine
        .transcribe(samples)
        .await
        .expect("transcribe Persian audio");

    assert!(!transcript.trim().is_empty(), "Shenava returned empty text");
    println!("Shenava smoke transcript: {transcript}");
}
