use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const LICENSE: &str = "CC-BY-NC-4.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading { progress: u8 },
    Error(String),
    Corrupted { file_size: u64, expected_size: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub display_name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub status: ModelStatus,
    pub description: String,
    pub license: String,
}

#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub name: &'static str,
    pub display_name: &'static str,
    pub repo: &'static str,
    pub revision: &'static str,
    pub model_bytes: u64,
    pub sha256: &'static str,
    pub description: &'static str,
}

pub const MODELS: [ModelSpec; 3] = [
    ModelSpec {
        name: "shenava-koochik-v1.0",
        display_name: "Koochik",
        repo: "Reza2kn/Shenava-Koochik-v1.0-sherpa-onnx",
        revision: "b67cd889f37746469b1396cf4236682aec72fd6d",
        model_bytes: 458_819_249,
        sha256: "6a564b5541920ce1c37bbc91d22e4b3a6838648b9b327eb88997e8db1f90950d",
        description: "Highest accuracy; 114M Persian FastConformer CTC",
    },
    ModelSpec {
        name: "shenava-rizeh-v1.0",
        display_name: "Rizeh",
        repo: "Reza2kn/Shenava-Rizeh-v1.0-sherpa-onnx",
        revision: "c542ce322851424975d6b818f740cfb3b15bd991",
        model_bytes: 116_700_660,
        sha256: "ec66d191f1eee10a1cc4b58ce5d2d328e160193975e118139e4600102550255b",
        description: "Balanced speed and accuracy; 32M parameters",
    },
    ModelSpec {
        name: "shenava-rizeh-pizeh-v1.0",
        display_name: "Rizeh Pizeh",
        repo: "Reza2kn/Shenava-Rizeh-Pizeh-v1.0-sherpa-onnx",
        revision: "b8056a6161ea7ee3f55f54ee6deb3ed765dac328",
        model_bytes: 33_201_018,
        sha256: "b1478bd8894558c26f0ce8fdd4a52afcc586ed03422510550425f24b21f68f66",
        description: "Smallest and fastest; 6.9M parameters",
    },
];

pub fn spec(name: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|model| model.name == name)
}

pub fn file_url(spec: &ModelSpec, file: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        spec.repo, spec.revision, file
    )
}
