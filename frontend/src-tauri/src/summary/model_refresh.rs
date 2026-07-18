//! Refresh + validation orchestration for the CLI model catalogs.
//!
//! Flow (per provider): fetch candidates (web-augmented CLI call) → sanitize
//! → probe-validate every id with a tiny real CLI call → persist only the
//! survivors. Validation is the reliability keystone — the fetched list is
//! never trusted directly.

use std::path::Path;

use super::model_catalog::{sanitize_candidates, ModelEntry, ModelListPayload, ValidationOutcome};
use super::model_store::{load_cache, now_unix, payload_from, save_cache, CachedCatalog};

/// How many validation probes run at once (each is a real CLI call).
const PROBE_CONCURRENCY: usize = 4;

/// Probe every candidate, a few at a time; keep only the ones that pass.
fn validate_concurrent<P>(candidates: Vec<ModelEntry>, probe: P) -> Vec<ModelEntry>
where
    P: Fn(&str) -> Result<(), String> + Sync,
{
    let mut kept = Vec::new();
    for chunk in candidates.chunks(PROBE_CONCURRENCY) {
        let verdicts: Vec<bool> = std::thread::scope(|s| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|e| {
                    let probe = &probe;
                    s.spawn(move || match probe(&e.id) {
                        Ok(()) => true,
                        Err(reason) => {
                            log::warn!("model probe rejected '{}': {}", e.id, reason);
                            false
                        }
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap_or(false))
                .collect()
        });
        kept.extend(
            chunk
                .iter()
                .zip(verdicts)
                .filter(|(_, ok)| *ok)
                .map(|(e, _)| e.clone()),
        );
    }
    kept
}

/// Full refresh: fetch → sanitize → validate → persist survivors.
pub fn refresh_flow<F, P>(
    app_data_dir: &Path,
    provider: &str,
    fetch: F,
    probe: P,
) -> Result<ModelListPayload, String>
where
    F: FnOnce() -> Result<Vec<ModelEntry>, String>,
    P: Fn(&str) -> Result<(), String> + Sync,
{
    let candidates = sanitize_candidates(fetch()?);
    log::info!("{provider}: validating {} candidates", candidates.len());
    let models = validate_concurrent(candidates, probe);
    let catalog = CachedCatalog {
        fetched_at: now_unix(),
        models,
    };
    save_cache(app_data_dir, provider, &catalog)?;
    Ok(payload_from(Some(catalog), false))
}

fn outcome(valid: bool, error: Option<String>) -> ValidationOutcome {
    ValidationOutcome { valid, error }
}

/// Probe one user-typed id; persist it into the cached list when it passes.
/// Probe failures come back as `valid:false` + the exact backend error (they
/// are an expected outcome, not a command error).
pub fn validate_and_add<P>(
    app_data_dir: &Path,
    provider: &str,
    model_id: &str,
    probe: P,
) -> Result<ValidationOutcome, String>
where
    P: Fn(&str) -> Result<(), String>,
{
    let id = model_id.trim();
    if id.is_empty() {
        return Ok(outcome(false, Some("Enter a model name.".into())));
    }
    if id.eq_ignore_ascii_case("default") {
        return Ok(outcome(true, None));
    }
    match probe(id) {
        Err(reason) => Ok(outcome(false, Some(reason))),
        Ok(()) => {
            let mut catalog = load_cache(app_data_dir, provider).unwrap_or_default();
            if !catalog.models.iter().any(|e| e.id.eq_ignore_ascii_case(id)) {
                catalog.models.push(ModelEntry {
                    id: id.into(),
                    label: id.into(),
                });
                if catalog.fetched_at == 0 {
                    catalog.fetched_at = now_unix();
                }
                save_cache(app_data_dir, provider, &catalog)?;
            }
            Ok(outcome(true, None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::model_store::cached_flow;

    fn entry(id: &str) -> ModelEntry {
        ModelEntry {
            id: id.into(),
            label: id.into(),
        }
    }

    #[test]
    fn refresh_flow_keeps_only_validated() {
        let dir = tempfile::tempdir().unwrap();
        let fetch = || Ok(vec![entry("good-1"), entry("bad-1"), entry("good-2")]);
        let probe = |id: &str| {
            if id.starts_with("good") {
                Ok(())
            } else {
                Err("model not supported".to_string())
            }
        };
        let p = refresh_flow(dir.path(), "codex", fetch, probe).unwrap();
        let ids: Vec<_> = p.models.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["default", "good-1", "good-2"]);
        assert!(!p.from_cache);
        assert_eq!(
            cached_flow(dir.path(), "codex").models.len(),
            3,
            "persisted"
        );
    }

    #[test]
    fn refresh_flow_propagates_fetch_errors_and_keeps_cache() {
        let dir = tempfile::tempdir().unwrap();
        save_cache(
            dir.path(),
            "codex",
            &CachedCatalog {
                fetched_at: 7,
                models: vec![entry("m")],
            },
        )
        .unwrap();
        let err =
            refresh_flow(dir.path(), "codex", || Err("offline".into()), |_| Ok(())).unwrap_err();
        assert_eq!(err, "offline");
        assert_eq!(
            cached_flow(dir.path(), "codex").models.len(),
            2,
            "cache untouched"
        );
    }

    #[test]
    fn validate_and_add_persists_once() {
        let dir = tempfile::tempdir().unwrap();
        let out = validate_and_add(dir.path(), "claude-code", " my-model ", |_| Ok(())).unwrap();
        assert!(out.valid);
        let out2 = validate_and_add(dir.path(), "claude-code", "MY-MODEL", |_| Ok(())).unwrap();
        assert!(out2.valid);
        let p = cached_flow(dir.path(), "claude-code");
        assert_eq!(p.models.len(), 2, "no duplicate entries");
        assert!(p.fetched_at.is_some());
    }

    #[test]
    fn validate_and_add_surfaces_probe_error() {
        let dir = tempfile::tempdir().unwrap();
        let out = validate_and_add(dir.path(), "codex", "bogus", |_| {
            Err(
                "The 'bogus' model is not supported when using Codex with a ChatGPT account."
                    .into(),
            )
        })
        .unwrap();
        assert!(!out.valid);
        assert!(out.error.unwrap().contains("not supported"));
        assert!(
            load_cache(dir.path(), "codex").is_none(),
            "nothing persisted"
        );
        assert!(
            !validate_and_add(dir.path(), "codex", "  ", |_| Ok(()))
                .unwrap()
                .valid
        );
        assert!(
            validate_and_add(dir.path(), "codex", "Default", |_| Err(
                "never called".into()
            ))
            .unwrap()
            .valid
        );
    }

    #[test]
    fn validate_concurrent_handles_more_than_one_chunk() {
        let candidates: Vec<_> = (0..9).map(|i| entry(&format!("m{i}"))).collect();
        let kept = validate_concurrent(candidates, |id| {
            if id.ends_with('3') || id.ends_with('7') {
                Err("no".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(kept.len(), 7);
        assert!(!kept.iter().any(|e| e.id == "m3" || e.id == "m7"));
    }
}
