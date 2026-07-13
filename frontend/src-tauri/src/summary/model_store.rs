//! Disk cache for the CLI provider model catalogs. Cached lists are served
//! until the user explicitly hits "Refresh models" — probes cost tokens and
//! seconds, so never re-fetch per-render.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model_catalog::{default_entry, ModelEntry, ModelListPayload};

/// What's persisted per provider under `app_data_dir/model_catalog/`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CachedCatalog {
    pub fetched_at: u64,
    pub models: Vec<ModelEntry>,
}

fn cache_path(app_data_dir: &Path, provider: &str) -> PathBuf {
    app_data_dir
        .join("model_catalog")
        .join(format!("{provider}.json"))
}

/// Scratch dir for a provider's fetch/probe runs (created on demand).
pub fn provider_workdir(app_data_dir: &Path, subdir: &str) -> Result<PathBuf, String> {
    let dir = app_data_dir.join("model_catalog").join(subdir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create model workdir: {e}"))?;
    Ok(dir)
}

pub fn load_cache(app_data_dir: &Path, provider: &str) -> Option<CachedCatalog> {
    let raw = std::fs::read_to_string(cache_path(app_data_dir, provider)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save_cache(
    app_data_dir: &Path,
    provider: &str,
    catalog: &CachedCatalog,
) -> Result<(), String> {
    let path = cache_path(app_data_dir, provider);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create model cache dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(catalog).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write model cache: {e}"))
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Payload = guaranteed `default` entry + whatever the cache holds.
pub fn payload_from(cache: Option<CachedCatalog>, from_cache: bool) -> ModelListPayload {
    let fetched_at = cache.as_ref().map(|c| c.fetched_at).filter(|t| *t > 0);
    let mut models = vec![default_entry()];
    if let Some(c) = cache {
        models.extend(c.models);
    }
    ModelListPayload {
        models,
        fetched_at,
        from_cache,
    }
}

/// Serve the cached list (or just `default` when nothing was fetched yet).
pub fn cached_flow(app_data_dir: &Path, provider: &str) -> ModelListPayload {
    payload_from(load_cache(app_data_dir, provider), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_roundtrip_and_payload_shape() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_cache(dir.path(), "codex").is_none());
        let empty = cached_flow(dir.path(), "codex");
        assert_eq!(empty.models.len(), 1, "always at least `default`");
        assert_eq!(empty.models[0].id, "default");
        assert_eq!(empty.fetched_at, None);
        assert!(empty.from_cache);

        let cat = CachedCatalog {
            fetched_at: 42,
            models: vec![ModelEntry {
                id: "m1".into(),
                label: "M1".into(),
            }],
        };
        save_cache(dir.path(), "codex", &cat).unwrap();
        let p = cached_flow(dir.path(), "codex");
        assert_eq!(p.models.len(), 2);
        assert_eq!(p.models[1].id, "m1");
        assert_eq!(p.fetched_at, Some(42));
    }

    #[test]
    fn zero_fetched_at_reads_as_never() {
        let p = payload_from(Some(CachedCatalog::default()), true);
        assert_eq!(p.fetched_at, None);
    }
}
