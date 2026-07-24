use super::engine;
use crate::shenava_engine::{ModelInfo, ModelStatus};

#[tauri::command]
pub async fn shenava_get_available_models() -> Result<Vec<ModelInfo>, String> {
    Ok(engine()?.discover_models().await)
}

#[tauri::command]
pub async fn shenava_load_model(model_name: String) -> Result<(), String> {
    engine()?
        .load_model(&model_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shenava_get_current_model() -> Result<Option<String>, String> {
    Ok(engine()?.current_model().await)
}

#[tauri::command]
pub async fn shenava_is_model_loaded() -> Result<bool, String> {
    Ok(engine()?.is_loaded().await)
}

#[tauri::command]
pub async fn shenava_has_available_models() -> Result<bool, String> {
    Ok(engine()?
        .discover_models()
        .await
        .iter()
        .any(|model| model.status == ModelStatus::Available))
}

#[tauri::command]
pub async fn shenava_validate_model_ready(model_name: String) -> Result<String, String> {
    let engine = engine()?;
    if engine.current_model().await.as_deref() != Some(&model_name) {
        let available = engine
            .discover_models()
            .await
            .into_iter()
            .find(|model| model.name == model_name && model.status == ModelStatus::Available)
            .ok_or_else(|| format!("Shenava model '{model_name}' is not downloaded"))?;
        engine
            .load_model(&available.name)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(model_name)
}

#[tauri::command]
pub async fn shenava_transcribe_audio(audio_data: Vec<f32>) -> Result<String, String> {
    engine()?
        .transcribe(audio_data)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shenava_get_models_directory() -> Result<String, String> {
    Ok(engine()?.models_dir().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn shenava_delete_model(model_name: String) -> Result<(), String> {
    crate::shenava_engine::catalog::spec(&model_name)
        .ok_or_else(|| format!("Unknown Shenava model: {model_name}"))?;
    let path = engine()?.models_dir().join(&model_name);
    tokio::fs::remove_dir_all(path)
        .await
        .map_err(|error| format!("Failed to delete Shenava model: {error}"))
}
