//! Tauri commands for the Codex CLI provider (Meetily-GM addition).

use serde::Serialize;

use super::login::{spawn_login_capture, LoginSession};
use super::{logout, read_account_info, resolve_codex_binary, CodexCliError};

/// Status payload for the settings UI.
#[derive(Debug, Clone, Serialize)]
pub struct CodexStatus {
    /// Installed AND signed in — ready to summarize.
    pub connected: bool,
    pub cli_installed: bool,
    pub cli_path: Option<String>,
    pub cli_version: Option<String>,
    pub user_email: Option<String>,
    /// Human-readable hint when user action is needed.
    pub detail: Option<String>,
}

const INSTALL_HINT: &str =
    "Codex CLI not found. Install Node.js, then run: npm i -g @openai/codex";

fn build_status() -> CodexStatus {
    match resolve_codex_binary() {
        Err(_) => CodexStatus {
            connected: false,
            cli_installed: false,
            cli_path: None,
            cli_version: None,
            user_email: None,
            detail: Some(INSTALL_HINT.to_string()),
        },
        Ok(install) => {
            let signed_in = super::login_status(&install).unwrap_or(false);
            let email = if signed_in {
                read_account_info().and_then(|a| a.email)
            } else {
                None
            };
            CodexStatus {
                connected: signed_in,
                cli_installed: true,
                cli_path: Some(install.path.to_string_lossy().to_string()),
                cli_version: install.version,
                user_email: email,
                detail: (!signed_in).then(|| {
                    "Codex CLI is installed but not signed in. Click 'Sign in with ChatGPT'."
                        .to_string()
                }),
            }
        }
    }
}

/// Report Codex CLI installation + sign-in state (spawns short subprocesses;
/// runs on the blocking pool).
#[tauri::command]
pub async fn codex_status() -> Result<CodexStatus, String> {
    tokio::task::spawn_blocking(build_status)
        .await
        .map_err(|e| e.to_string())
}

/// Launch the CLI's browser sign-in. `codex login` opens the browser and runs
/// its own localhost callback server; we also capture the auth URL it prints
/// and open it ourselves, so sign-in is not left stranded if codex's built-in
/// auto-open silently fails. The URL is returned so the UI can show a manual
/// fallback. Frontend polls `codex_status` until `connected` flips.
#[tauri::command]
pub async fn codex_login_start() -> Result<LoginSession, String> {
    tokio::task::spawn_blocking(|| {
        let install = resolve_codex_binary().map_err(|e| match e {
            CodexCliError::NotInstalled => INSTALL_HINT.to_string(),
            other => other.to_string(),
        })?;
        let session = spawn_login_capture(&install)?;
        if let Some(url) = &session.auth_url {
            let _ = crate::platform::api_open_external(url.clone());
        }
        Ok(session)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sign out via `codex logout`.
#[tauri::command]
pub async fn codex_logout() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let install = resolve_codex_binary().map_err(|e| e.to_string())?;
        logout(&install).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
