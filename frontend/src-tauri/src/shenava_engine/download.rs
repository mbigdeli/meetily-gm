use super::catalog::{file_url, spec};
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub model_name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress: u8,
}

pub async fn download_model<F>(models_dir: &Path, name: &str, mut progress: F) -> Result<()>
where
    F: FnMut(DownloadProgress),
{
    let model = spec(name).ok_or_else(|| anyhow!("unknown Shenava model: {name}"))?;
    let model_dir = models_dir.join(name);
    tokio::fs::create_dir_all(&model_dir).await?;
    download_verified(
        &file_url(model, "model.onnx"),
        &model_dir.join("model.onnx"),
        model.model_bytes,
        model.sha256,
        name,
        &mut progress,
    )
    .await?;
    download_small(
        &file_url(model, "tokens.txt"),
        &model_dir.join("tokens.txt"),
    )
    .await?;
    Ok(())
}

async fn download_verified<F>(
    url: &str,
    destination: &Path,
    expected_size: u64,
    expected_sha: &str,
    name: &str,
    progress: &mut F,
) -> Result<()>
where
    F: FnMut(DownloadProgress),
{
    let temporary = destination.with_extension("onnx.part");
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&temporary).await?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        progress(DownloadProgress {
            model_name: name.into(),
            downloaded_bytes: downloaded,
            total_bytes: expected_size,
            progress: ((downloaded as f64 / expected_size as f64) * 100.0).min(100.0) as u8,
        });
    }
    file.flush().await?;
    if downloaded != expected_size || format!("{:x}", hasher.finalize()) != expected_sha {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(anyhow!(
            "downloaded Shenava model failed integrity validation"
        ));
    }
    tokio::fs::rename(temporary, destination)
        .await
        .context("failed to finalize Shenava model download")
}

async fn download_small(url: &str, destination: &Path) -> Result<()> {
    let bytes = reqwest::get(url).await?.error_for_status()?.bytes().await?;
    tokio::fs::write(destination, bytes).await?;
    Ok(())
}
