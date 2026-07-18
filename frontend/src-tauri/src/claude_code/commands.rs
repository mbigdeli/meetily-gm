//! Tauri commands for the Claude Code CLI provider (Miting). Mirrors codex.

use serde::Serialize;

use super::auth::{self, ClaudeLoginSession};
use super::resolve::resolve_claude_binary;
use super::ClaudeCliError;

const INSTALL_HINT: &str =
    "Claude Code CLI not found. Install Node.js, then run: npm i -g @anthropic-ai/claude-code";

/// Status payload for the settings UI.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStatus {
    /// Installed AND signed in — ready to summarize.
    pub connected: bool,
    pub cli_installed: bool,
    pub cli_path: Option<String>,
    pub cli_version: Option<String>,
    pub user_email: Option<String>,
    pub subscription_type: Option<String>,
    /// Human-readable hint when user action is needed.
    pub detail: Option<String>,
}

fn build_status() -> ClaudeStatus {
    match resolve_claude_binary() {
        Err(_) => ClaudeStatus {
            connected: false,
            cli_installed: false,
            cli_path: None,
            cli_version: None,
            user_email: None,
            subscription_type: None,
            detail: Some(INSTALL_HINT.to_string()),
        },
        Ok(install) => {
            let acct = auth::auth_status(&install);
            ClaudeStatus {
                connected: acct.logged_in,
                cli_installed: true,
                cli_path: Some(install.path.to_string_lossy().to_string()),
                cli_version: install.version.clone(),
                user_email: acct.email,
                subscription_type: acct.subscription_type,
                detail: (!acct.logged_in).then(|| {
                    "Claude Code CLI is installed but not signed in. Click 'Sign in with Claude'."
                        .to_string()
                }),
            }
        }
    }
}

/// Report Claude Code CLI installation + sign-in state.
#[tauri::command]
pub async fn claude_code_status() -> Result<ClaudeStatus, String> {
    tokio::task::spawn_blocking(build_status)
        .await
        .map_err(|e| e.to_string())
}

/// Launch `claude auth login` (browser), capture the URL, and open it. The
/// frontend polls `claude_code_status` until `connected` flips.
#[tauri::command]
pub async fn claude_code_login_start() -> Result<ClaudeLoginSession, String> {
    tokio::task::spawn_blocking(|| {
        let install = resolve_claude_binary().map_err(|e| match e {
            ClaudeCliError::NotInstalled => INSTALL_HINT.to_string(),
            other => other.to_string(),
        })?;
        let session = auth::spawn_login_capture(&install)?;
        if let Some(url) = &session.auth_url {
            let _ = crate::platform::api_open_external(url.clone());
        }
        Ok(session)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sign out via `claude auth logout`.
#[tauri::command]
pub async fn claude_code_logout() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let install = resolve_claude_binary().map_err(|e| e.to_string())?;
        Ok(auth::logout(&install))
    })
    .await
    .map_err(|e| e.to_string())?
}
