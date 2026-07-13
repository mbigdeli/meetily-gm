//! Dynamic model catalog for the Codex CLI provider. Fetch: one `codex exec`
//! with the native web_search tool (`-c tools.web_search=true` — verified
//! working under `--sandbox read-only`). Probe: a tiny `codex exec -m <id>`
//! per candidate; the ChatGPT backend 400s unknown/retired ids. Blocking.

use std::ffi::OsString;
use std::path::Path;
use std::process::Command;

use crate::cli_proc::run_with_stdin;
use crate::summary::model_catalog::{entry, ModelEntry, ModelListPayload, ValidationOutcome};
use crate::summary::model_parse::{extract_error_message, fetch_prompt, parse_models_json};
use crate::summary::{model_refresh, model_store};

use super::{codex_home, preflight, CodexCliError, CodexInstall};

pub const PROVIDER_KEY: &str = "codex";
const FETCH_TIMEOUT_SECS: u64 = 300;
const PROBE_TIMEOUT_SECS: u64 = 90;
const PROBE_PROMPT: &str = "Reply with exactly: OK";

/// Shared `codex exec` prefix (mirrors the summary path's hardening flags).
const BASE_FLAGS: &str = "exec --skip-git-repo-check --sandbox read-only --color never --ephemeral";

fn base_args(workdir: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = BASE_FLAGS.split(' ').map(OsString::from).collect();
    args.push("-C".into());
    args.push(workdir.as_os_str().to_os_string());
    args
}

fn friendly_preflight_err(e: CodexCliError) -> String {
    match e {
        CodexCliError::NotInstalled => "Codex CLI missing — run: npm i -g @openai/codex".into(),
        CodexCliError::NotLoggedIn => "Not signed in — use 'Sign in with ChatGPT' first.".into(),
        other => other.to_string(),
    }
}

/// The model pinned in `~/.codex/config.toml` is a known-good id — seed it.
pub(crate) fn parse_config_toml_model(raw: &str) -> Option<String> {
    raw.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("model")?.trim_start();
        let id = rest.strip_prefix('=')?.trim().trim_matches('"').trim();
        (!id.is_empty()).then(|| id.to_string())
    })
}

fn config_toml_seed() -> Option<ModelEntry> {
    let raw = std::fs::read_to_string(codex_home()?.join("config.toml")).ok()?;
    let id = parse_config_toml_model(&raw)?;
    Some(entry(&id, &id))
}

/// Ask codex (with live web search) for current model ids. Untrusted output;
/// the caller sanitizes and probe-validates every id.
fn fetch_candidates(install: &CodexInstall, workdir: &Path) -> Result<Vec<ModelEntry>, String> {
    let last_message = workdir.join("codex_last_message.txt");
    let _ = std::fs::remove_file(&last_message);
    let mut args = base_args(workdir);
    for a in ["-c", "tools.web_search=true", "--output-last-message"] {
        args.push(a.into());
    }
    args.push(last_message.clone().into_os_string());
    args.push("-".into());
    let mut cmd = Command::new(&install.path);
    cmd.args(args);
    let prompt = fetch_prompt("Codex CLI", "OpenAI", "codex -m <MODEL>");
    let (code, stdout, stderr) = run_with_stdin(cmd, &prompt, FETCH_TIMEOUT_SECS)?;
    if code != 0 {
        let msg = extract_error_message(&stderr);
        return Err(format!("codex model fetch failed: {msg}"));
    }
    let text = std::fs::read_to_string(&last_message).unwrap_or(stdout);
    let _ = std::fs::remove_file(&last_message);
    parse_models_json(&text)
}

/// Tiny real call with `-m <id>`; nonzero exit means the backend rejected it.
fn probe_model(install: &CodexInstall, workdir: &Path, id: &str) -> Result<(), String> {
    let mut args = base_args(workdir);
    for a in ["-m", id, "-"] {
        args.push(a.into());
    }
    let mut cmd = Command::new(&install.path);
    cmd.args(args);
    let (code, _stdout, stderr) = run_with_stdin(cmd, PROBE_PROMPT, PROBE_TIMEOUT_SECS)?;
    if code == 0 {
        Ok(())
    } else {
        Err(extract_error_message(&stderr))
    }
}

/// List models: cached read, or full fetch → validate → persist on refresh.
pub fn list_models(app_data_dir: &Path, refresh: bool) -> Result<ModelListPayload, String> {
    if !refresh {
        return Ok(model_store::cached_flow(app_data_dir, PROVIDER_KEY));
    }
    let install = preflight().map_err(friendly_preflight_err)?;
    let wd = model_store::provider_workdir(app_data_dir, "codex_work")?;
    let fetch = || {
        let mut candidates = fetch_candidates(&install, &wd)?;
        candidates.extend(config_toml_seed());
        Ok(candidates)
    };
    model_refresh::refresh_flow(app_data_dir, PROVIDER_KEY, fetch, |id| {
        probe_model(&install, &wd, id)
    })
}

/// Probe one user-typed id (manual-entry fallback); persist when valid.
pub fn validate_custom(app_data_dir: &Path, model: &str) -> Result<ValidationOutcome, String> {
    let install = preflight().map_err(friendly_preflight_err)?;
    let wd = model_store::provider_workdir(app_data_dir, "codex_work")?;
    model_refresh::validate_and_add(app_data_dir, PROVIDER_KEY, model, |id| {
        probe_model(&install, &wd, id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_args_mirror_summary_hardening() {
        let strs: Vec<String> = base_args(Path::new("C:\\w"))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(strs[0], "exec");
        for flag in [
            "--skip-git-repo-check",
            "--sandbox",
            "--color",
            "--ephemeral",
            "-C",
        ] {
            assert!(strs.contains(&flag.to_string()), "missing {flag}");
        }
    }

    #[test]
    fn config_toml_model_line_parses() {
        let raw = "# comment\nmodel_provider = \"openai\"\nmodel = \"gpt-5.6-sol\"\n";
        assert_eq!(parse_config_toml_model(raw).as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(parse_config_toml_model("model_provider = \"x\"\n"), None);
        assert_eq!(parse_config_toml_model("model = \"\"\n"), None);
        assert_eq!(parse_config_toml_model(""), None);
    }

    #[cfg(windows)]
    #[test]
    fn probe_model_passes_id_and_reads_exit_code() {
        // Fake codex (cmd builtins only): exits 0 only when `-m good` is
        // present. Codex args have no empty values, so a shift loop is safe.
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake_codex.cmd");
        std::fs::write(
            &fake,
            "@echo off\r\nset OK=0\r\n:loop\r\nif \"%~1\"==\"\" goto done\r\nif \"%~1\"==\"-m\" if \"%~2\"==\"good\" set OK=1\r\nshift\r\ngoto loop\r\n:done\r\nif \"%OK%\"==\"1\" exit /b 0\r\necho {\"error\":{\"message\":\"The 'bad' model is not supported when using Codex with a ChatGPT account.\"}} 1>&2\r\nexit /b 1\r\n",
        )
        .unwrap();
        let install = CodexInstall {
            path: fake,
            version: None,
        };
        let wd = dir.path().join("w");
        std::fs::create_dir_all(&wd).unwrap();
        assert!(probe_model(&install, &wd, "good").is_ok());
        let err = probe_model(&install, &wd, "bad").unwrap_err();
        assert!(err.contains("not supported"), "got: {err}");
    }
}
