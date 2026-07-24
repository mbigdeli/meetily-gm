use super::engine;
use crate::shenava_engine::download::download_model;
use tauri::{AppHandle, Emitter, Runtime};

#[tauri::command]
pub async fn shenava_download_model<R: Runtime>(
    app: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let models_dir = engine()?.models_dir().clone();
    let progress_app = app.clone();
    let result = download_model(&models_dir, &model_name, move |progress| {
        let _ = progress_app.emit("shenava-model-download-progress", progress);
    })
    .await;

    match result {
        Ok(()) => app
            .emit(
                "shenava-model-download-complete",
                serde_json::json!({ "modelName": model_name }),
            )
            .map_err(|error| error.to_string()),
        Err(error) => {
            let message = error.to_string();
            let _ = app.emit(
                "shenava-model-download-error",
                serde_json::json!({ "modelName": model_name, "error": message }),
            );
            Err(message)
        }
    }
}
