//! Tauri commands for the dynamic CLI model catalogs (codex + claude-code).
//!
//! `refresh:false` serves the disk cache (instant, no CLI calls); the
//! "Refresh models" button passes `refresh:true`, which runs the full
//! web-augmented fetch + per-id validation (real CLI calls — seconds, not
//! milliseconds). The `*_validate_model` commands back the manual-entry
//! fallback and persist ids that pass.

use tauri::Manager;

use super::model_catalog::{ModelListPayload, ValidationOutcome};

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))
}

#[tauri::command]
pub async fn codex_list_models(
    app: tauri::AppHandle,
    refresh: bool,
) -> Result<ModelListPayload, String> {
    let dir = data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::codex::models::list_models(&dir, refresh))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_validate_model(
    app: tauri::AppHandle,
    model: String,
) -> Result<ValidationOutcome, String> {
    let dir = data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::codex::models::validate_custom(&dir, &model))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn claude_list_models(
    app: tauri::AppHandle,
    refresh: bool,
) -> Result<ModelListPayload, String> {
    let dir = data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::claude_code::models::list_models(&dir, refresh))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn claude_validate_model(
    app: tauri::AppHandle,
    model: String,
) -> Result<ValidationOutcome, String> {
    let dir = data_dir(&app)?;
    tokio::task::spawn_blocking(move || crate::claude_code::models::validate_custom(&dir, &model))
        .await
        .map_err(|e| e.to_string())?
}
