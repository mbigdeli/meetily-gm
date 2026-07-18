//! Dynamic model catalog for the Claude Code CLI provider. Fetch: one
//! `claude --print` with WebSearch enabled — needs `--tools WebSearch
//! --allowed-tools WebSearch` AND a prompt that forces a search (verified:
//! the model otherwise answers from stale knowledge). Isolation flags keep
//! calls clean — plain `claude -p` loads the user's MCP servers, plugins and
//! CLAUDE.md. Probe: `--model <id>`, tools off. Aliases seeded (never stale).

use std::ffi::OsString;
use std::path::Path;
use std::process::Command;

use crate::cli_proc::run_with_stdin;
use crate::summary::model_catalog::{entry, ModelEntry, ModelListPayload, ValidationOutcome};
use crate::summary::model_parse::{extract_error_message, fetch_prompt, parse_models_json};
use crate::summary::{model_refresh, model_store};

use super::resolve::resolve_claude_binary;
use super::{auth, ClaudeCliError, ClaudeInstall};

pub const PROVIDER_KEY: &str = "claude-code";
const FETCH_TIMEOUT_SECS: u64 = 300;
const PROBE_TIMEOUT_SECS: u64 = 90;
const PROBE_PROMPT: &str = "Reply with exactly: OK";

/// `--print` + isolation flags (no user settings, no MCP, no session files).
const BASE_FLAGS: &[&str] = &[
    "--print",
    "--output-format",
    "text",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
];

/// Stable aliases resolve server-side to the latest model of each family.
const ALIAS_SEEDS: &[&str] = &["opus", "sonnet", "haiku"];

fn signed_in_install() -> Result<ClaudeInstall, String> {
    let install = resolve_claude_binary().map_err(|e| match e {
        ClaudeCliError::NotInstalled => {
            "Claude Code CLI is not installed. Run: npm i -g @anthropic-ai/claude-code".to_string()
        }
        other => other.to_string(),
    })?;
    if !auth::auth_status(&install).logged_in {
        return Err("Claude Code CLI is not signed in. Use 'Sign in with Claude' first.".into());
    }
    Ok(install)
}

fn run_claude(
    install: &ClaudeInstall,
    workdir: &Path,
    extra: &[&str],
    stdin: &str,
    timeout: u64,
) -> Result<(i32, String, String), String> {
    let mut args: Vec<OsString> = BASE_FLAGS.iter().map(OsString::from).collect();
    args.extend(extra.iter().map(OsString::from));
    let mut cmd = Command::new(&install.path);
    cmd.args(args).current_dir(workdir);
    run_with_stdin(cmd, stdin, timeout)
}

/// Ask claude (forced WebSearch) for current model ids. Untrusted output;
/// the caller sanitizes and probe-validates every id.
fn fetch_candidates(install: &ClaudeInstall, workdir: &Path) -> Result<Vec<ModelEntry>, String> {
    let prompt = fetch_prompt("Claude Code CLI", "Anthropic", "claude --model <MODEL>");
    let extra = ["--tools", "WebSearch", "--allowed-tools", "WebSearch"];
    let (code, stdout, stderr) = run_claude(install, workdir, &extra, &prompt, FETCH_TIMEOUT_SECS)?;
    if code != 0 {
        let msg = extract_error_message(&stderr);
        return Err(format!("claude model fetch failed: {msg}"));
    }
    parse_models_json(&stdout)
}

/// Tiny real call with `--model <id>`; nonzero exit means it was rejected.
fn probe_model(install: &ClaudeInstall, workdir: &Path, id: &str) -> Result<(), String> {
    let extra = ["--tools", "", "--model", id];
    let (code, stdout, stderr) =
        run_claude(install, workdir, &extra, PROBE_PROMPT, PROBE_TIMEOUT_SECS)?;
    if code == 0 && !stdout.trim().is_empty() {
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
    let install = signed_in_install()?;
    let wd = model_store::provider_workdir(app_data_dir, "claude_work")?;
    let fetch = || {
        // Aliases first so they survive the sanitize cap; fetch adds full ids.
        let mut candidates: Vec<ModelEntry> = ALIAS_SEEDS
            .iter()
            .map(|id| entry(*id, format!("{id} (latest)")))
            .collect();
        candidates.extend(fetch_candidates(&install, &wd)?);
        Ok(candidates)
    };
    model_refresh::refresh_flow(app_data_dir, PROVIDER_KEY, fetch, |id| {
        probe_model(&install, &wd, id)
    })
}

/// Probe one user-typed id (manual-entry fallback); persist when valid.
pub fn validate_custom(app_data_dir: &Path, model: &str) -> Result<ValidationOutcome, String> {
    let install = signed_in_install()?;
    let wd = model_store::provider_workdir(app_data_dir, "claude_work")?;
    model_refresh::validate_and_add(app_data_dir, PROVIDER_KEY, model, |id| {
        probe_model(&install, &wd, id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_flags_isolate_from_user_config() {
        let i = BASE_FLAGS
            .iter()
            .position(|s| *s == "--setting-sources")
            .expect("has flag");
        assert_eq!(BASE_FLAGS[i + 1], "", "explicit empty source list");
        assert_eq!(BASE_FLAGS[0], "--print");
        assert!(BASE_FLAGS.contains(&"--strict-mcp-config"));
        assert!(BASE_FLAGS.contains(&"--no-session-persistence"));
    }

    #[cfg(windows)]
    #[test]
    fn probe_model_maps_exit_codes() {
        // cmd builtins only: under `cargo test` the injected PATH is one
        // cmd.exe can't use, so fakes must not call external binaries
        // (findstr/ping). Success and rejection are separate fakes.
        let dir = tempfile::tempdir().unwrap();
        let ok = dir.path().join("fake_claude_ok.cmd");
        std::fs::write(&ok, "@echo off\r\necho OK\r\n").unwrap();
        let install = ClaudeInstall {
            path: ok,
            version: None,
        };
        assert!(probe_model(&install, dir.path(), "opus").is_ok());

        let bad = dir.path().join("fake_claude_bad.cmd");
        std::fs::write(
            &bad,
            "@echo off\r\necho API Error: 404 {\"error\":{\"message\":\"model: nope\"}} 1>&2\r\nexit /b 1\r\n",
        )
        .unwrap();
        let install = ClaudeInstall {
            path: bad,
            version: None,
        };
        let err = probe_model(&install, dir.path(), "nope").unwrap_err();
        assert!(err.contains("model: nope"), "got: {err}");

        // Exit 0 with empty stdout is still a failure (no real reply).
        let silent = dir.path().join("fake_claude_silent.cmd");
        std::fs::write(&silent, "@echo off\r\n").unwrap();
        let install = ClaudeInstall {
            path: silent,
            version: None,
        };
        assert!(probe_model(&install, dir.path(), "opus").is_err());
    }
}
