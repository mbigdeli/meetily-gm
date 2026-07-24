mod download;
mod models;

pub use download::*;
pub use models::*;

use super::ShenavaEngine;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime};

pub static SHENAVA_ENGINE: Mutex<Option<Arc<ShenavaEngine>>> = Mutex::new(None);
static MODELS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_models_directory<R: Runtime>(app: &AppHandle<R>) {
    match app.path().app_data_dir() {
        Ok(path) => {
            if let Ok(mut guard) = MODELS_DIR.lock() {
                *guard = Some(path.join("models"));
            }
        }
        Err(error) => log::error!("Failed to resolve Shenava models directory: {error}"),
    }
}

pub(crate) fn engine() -> Result<Arc<ShenavaEngine>, String> {
    SHENAVA_ENGINE
        .lock()
        .map_err(|_| "Shenava engine lock is poisoned".to_string())?
        .as_ref()
        .cloned()
        .ok_or_else(|| "Shenava engine is not initialized".to_string())
}

#[tauri::command]
pub async fn shenava_init() -> Result<(), String> {
    let mut guard = SHENAVA_ENGINE
        .lock()
        .map_err(|_| "Shenava engine lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let models_dir = MODELS_DIR
        .lock()
        .map_err(|_| "Shenava models directory lock is poisoned".to_string())?
        .clone()
        .ok_or_else(|| "Shenava models directory is not configured".to_string())?;
    *guard = Some(Arc::new(
        ShenavaEngine::new(models_dir).map_err(|error| error.to_string())?,
    ));
    Ok(())
}
