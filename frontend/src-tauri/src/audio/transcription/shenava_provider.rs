use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use std::sync::Arc;

pub struct ShenavaProvider {
    engine: Arc<crate::shenava_engine::ShenavaEngine>,
}

impl ShenavaProvider {
    pub fn new(engine: Arc<crate::shenava_engine::ShenavaEngine>) -> Self {
        Self { engine }
    }
}

pub async fn validate_model(model_name: &str) -> Result<String, String> {
    crate::shenava_engine::commands::shenava_init().await?;
    crate::shenava_engine::commands::shenava_validate_model_ready(model_name.to_string()).await
}

pub async fn loaded_provider() -> Result<Arc<dyn TranscriptionProvider>, String> {
    let engine = crate::shenava_engine::commands::SHENAVA_ENGINE
        .lock()
        .map_err(|_| "Shenava engine lock is poisoned".to_string())?
        .as_ref()
        .cloned()
        .ok_or_else(|| "Shenava engine is not initialized".to_string())?;
    if !engine.is_loaded().await {
        return Err("Shenava engine has no loaded model".to_string());
    }
    Ok(Arc::new(ShenavaProvider::new(engine)))
}

pub async fn engine_for_model(
    model_name: Option<&str>,
) -> Result<Arc<crate::shenava_engine::ShenavaEngine>, String> {
    let name = model_name.unwrap_or("shenava-rizeh-v1.0");
    validate_model(name).await?;
    crate::shenava_engine::commands::SHENAVA_ENGINE
        .lock()
        .map_err(|_| "Shenava engine lock is poisoned".to_string())?
        .as_ref()
        .cloned()
        .ok_or_else(|| "Shenava engine is not initialized".to_string())
}

#[async_trait]
impl TranscriptionProvider for ShenavaProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        if let Some(language) = language {
            if language != "fa" {
                log::warn!("Shenava is Persian-only; ignoring language hint '{language}'");
            }
        }
        self.engine
            .transcribe(audio)
            .await
            .map(|text| TranscriptResult {
                text: text.trim().to_string(),
                confidence: None,
                is_partial: false,
            })
            .map_err(|error| TranscriptionError::EngineFailed(error.to_string()))
    }

    async fn is_model_loaded(&self) -> bool {
        self.engine.is_loaded().await
    }

    async fn get_current_model(&self) -> Option<String> {
        self.engine.current_model().await
    }

    fn provider_name(&self) -> &'static str {
        "Shenava"
    }
}
