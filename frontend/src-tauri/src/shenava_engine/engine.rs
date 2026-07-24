use super::catalog::{spec, ModelInfo, ModelStatus, LICENSE, MODELS};
use super::process::ShenavaProcess;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

pub struct ShenavaEngine {
    models_dir: PathBuf,
    process: Arc<Mutex<Option<ShenavaProcess>>>,
    current_model: Arc<RwLock<Option<String>>>,
}

impl ShenavaEngine {
    pub fn new(models_dir: PathBuf) -> Result<Self> {
        let models_dir = models_dir.join("shenava");
        std::fs::create_dir_all(&models_dir)?;
        Ok(Self {
            models_dir,
            process: Arc::new(Mutex::new(None)),
            current_model: Arc::new(RwLock::new(None)),
        })
    }

    pub fn models_dir(&self) -> &PathBuf {
        &self.models_dir
    }

    pub async fn discover_models(&self) -> Vec<ModelInfo> {
        MODELS
            .iter()
            .map(|model| self.model_info(model))
            .collect()
    }

    pub async fn load_model(&self, name: &str) -> Result<()> {
        spec(name).ok_or_else(|| anyhow!("unknown Shenava model: {name}"))?;
        let dir = self.models_dir.join(name);
        let process = ShenavaProcess::start(&dir).await?;
        *self.process.lock().await = Some(process);
        *self.current_model.write().await = Some(name.to_string());
        Ok(())
    }

    pub async fn transcribe(&self, samples: Vec<f32>) -> Result<String> {
        let mut guard = self.process.lock().await;
        let process = guard.as_mut().ok_or_else(|| anyhow!("no Shenava model loaded"))?;
        process.transcribe(&samples).await
    }

    pub async fn current_model(&self) -> Option<String> {
        self.current_model.read().await.clone()
    }

    pub async fn is_loaded(&self) -> bool {
        self.process.lock().await.is_some()
    }

    pub async fn unload_model(&self) -> bool {
        let was_loaded = self.process.lock().await.take().is_some();
        *self.current_model.write().await = None;
        was_loaded
    }

    fn model_info(&self, model: &super::catalog::ModelSpec) -> ModelInfo {
        let path = self.models_dir.join(model.name);
        let model_path = path.join("model.onnx");
        let tokens_path = path.join("tokens.txt");
        let status = match std::fs::metadata(&model_path) {
            Ok(meta) if meta.len() == model.model_bytes && tokens_path.exists() => {
                ModelStatus::Available
            }
            Ok(meta) => ModelStatus::Corrupted {
                file_size: meta.len(),
                expected_size: model.model_bytes,
            },
            Err(_) => ModelStatus::Missing,
        };
        ModelInfo {
            name: model.name.into(),
            display_name: model.display_name.into(),
            path,
            size_mb: (model.model_bytes / 1_000_000) as u32,
            status,
            description: model.description.into(),
            license: LICENSE.into(),
        }
    }
}
