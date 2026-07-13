//! Anthropic Claude Code CLI integration (Miting addition).
//!
//! Runs summarization through the locally installed `claude` CLI, which
//! authenticates with the user's Claude Pro/Max subscription — no API key, no
//! per-token billing. Sibling of the `codex` module; the two subscription-CLI
//! providers mean a Claude subscriber never has to switch to ChatGPT to get a
//! zero-extra-cost summary. Strictly for the signed-in user's own use on this
//! device (see docs/product-plan/14-claude-code-provider.md §7).
//!
//! Ships both the execution path (resolve + `claude --print` + summary entry
//! point) and the auth path: the `auth` module wraps `claude auth
//! status/login/logout` (verified against the real CLI) and `commands` exposes
//! the matching Tauri status/login/logout for the settings card.

pub mod auth;
pub mod commands;
pub mod exec;
pub mod process;
pub mod resolve;

use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

/// Env override: when set, the only `claude` binary considered (also the test
/// hook so tests never touch a real install — mirrors MEETILY_CODEX_EXE).
pub const CLAUDE_EXE_ENV: &str = "MITING_CLAUDE_EXE";

pub const EXEC_TIMEOUT_SECS: u64 = 600;
pub(crate) const STATUS_TIMEOUT_SECS: u64 = 15;
pub(crate) const WAIT_POLL_INTERVAL_MS: u64 = 250;
pub(crate) const TAIL_LIMIT: usize = 16 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ClaudeCliError {
    #[error("claude_code_not_installed")]
    NotInstalled,
    #[error("claude_code_not_logged_in")]
    NotLoggedIn,
    #[error("claude print timed out after {0}s")]
    Timeout(u64),
    #[error("claude print was cancelled")]
    Cancelled,
    #[error("claude spawn failed: {0}")]
    Spawn(String),
    #[error("claude exited with code {code}: {stderr_tail}")]
    NonZeroExit { code: i32, stderr_tail: String },
    #[error("claude output invalid: {0}")]
    BadOutput(String),
}

/// A resolved Claude Code CLI installation.
#[derive(Debug, Clone)]
pub struct ClaudeInstall {
    pub path: PathBuf,
    pub version: Option<String>,
}

/// Async summary entry point used by the LLM client. Claude Code has a single
/// prompt channel, so the system prompt is inlined ahead of the user prompt.
/// Runs in `spawn_blocking`; honors the cancellation token (kills the child).
/// Normalize a stored model choice into a CLI `--model` value: `None` for the
/// sentinel "default"/empty, else the alias/name (e.g. `opus`, `sonnet`).
pub(crate) fn model_flag(model: &str) -> Option<String> {
    let m = model.trim();
    (!m.is_empty() && !m.eq_ignore_ascii_case("default")).then(|| m.to_string())
}

pub async fn generate_with_claude_code(
    _app_data_dir: &Path,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    let install = tokio::task::block_in_place(resolve::resolve_claude_binary).map_err(|e| match e {
        ClaudeCliError::NotInstalled => {
            "Claude Code CLI is not installed. Install it, then sign in with your Claude subscription."
                .to_string()
        }
        other => other.to_string(),
    })?;

    let prompt = format!("{system_prompt}\n\n{user_prompt}");
    let token = cancellation_token.cloned();
    let model = model_flag(model);

    tokio::task::spawn_blocking(move || {
        exec::exec_blocking(&install, &prompt, model.as_deref(), token.as_ref())
    })
    .await
        .map_err(|e| format!("claude task join error: {e}"))?
        .map_err(|e| match e {
            ClaudeCliError::NotLoggedIn => {
                "Claude Code CLI is not signed in. Sign in with your Claude subscription (run `claude` and use /login)."
                    .to_string()
            }
            other => other.to_string(),
        })
}
