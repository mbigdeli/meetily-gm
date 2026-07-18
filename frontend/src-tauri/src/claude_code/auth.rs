//! Claude Code authentication via `claude auth {status,login,logout}` (Miting).
//! The CLI owns all credentials (Claude subscription OAuth); this app stores
//! nothing. Mirrors the codex module's auth handling.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::process::{creation_no_window, run_to_completion};
use super::{ClaudeInstall, STATUS_TIMEOUT_SECS};

const URL_WAIT_SECS: u64 = 8;
const LOGIN_DEADLINE_SECS: u64 = 300;

/// Sign-in state parsed from `claude auth status --json` (best-effort).
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ClaudeAccount {
    pub logged_in: bool,
    pub email: Option<String>,
    pub subscription_type: Option<String>,
}

/// Result of launching `claude auth login`: child pid + captured browser URL.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClaudeLoginSession {
    pub pid: u32,
    pub auth_url: Option<String>,
}

/// Parse the `claude auth status --json` payload. Pure; unit-tested.
pub fn parse_status(stdout: &str) -> ClaudeAccount {
    let Some(start) = stdout.find('{') else {
        return ClaudeAccount::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&stdout[start..]) else {
        return ClaudeAccount::default();
    };
    ClaudeAccount {
        logged_in: v.get("loggedIn").and_then(|b| b.as_bool()).unwrap_or(false),
        email: v.get("email").and_then(|s| s.as_str()).map(String::from),
        subscription_type: v
            .get("subscriptionType")
            .and_then(|s| s.as_str())
            .map(String::from),
    }
}

/// Extract the OAuth URL from one line of `claude auth login` output. Pure; tested.
pub fn parse_auth_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches(['.', ',', ')', '"', '\'', '>']);
    let looks_auth = url.contains("claude.ai")
        || url.contains("anthropic.com")
        || url.contains("/oauth")
        || url.contains("/authorize");
    looks_auth.then(|| url.to_string())
}

/// `claude auth status --json` → parsed account (never fails hard).
pub fn auth_status(install: &ClaudeInstall) -> ClaudeAccount {
    let mut cmd = Command::new(&install.path);
    cmd.args(["auth", "status", "--json"]);
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    match run_to_completion(cmd, STATUS_TIMEOUT_SECS, None) {
        Ok((_code, stdout, _stderr)) => parse_status(&stdout),
        Err(_) => ClaudeAccount::default(),
    }
}

/// Launch `claude auth login`, capturing the browser URL via a temp file (a
/// file handle survives an npm-shim detach; a pipe does not). Child kept alive
/// for its OAuth callback, force-killed after [`LOGIN_DEADLINE_SECS`].
pub fn spawn_login_capture(install: &ClaudeInstall) -> Result<ClaudeLoginSession, String> {
    let log = std::env::temp_dir().join(format!("miting_claude_login_{}.log", std::process::id()));
    let _ = std::fs::remove_file(&log);
    let file = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let file_err = file.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&install.path);
    cmd.args(["auth", "login", "--claudeai"])
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(file_err));
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    let deadline = Instant::now() + Duration::from_secs(URL_WAIT_SECS);
    let mut auth_url = None;
    while Instant::now() < deadline {
        if let Ok(s) = std::fs::read_to_string(&log) {
            if let Some(u) = s.lines().find_map(parse_auth_url) {
                auth_url = Some(u);
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    std::thread::spawn(move || {
        let mut child = child;
        std::thread::sleep(Duration::from_secs(LOGIN_DEADLINE_SECS));
        let _ = child.kill();
        let _ = child.wait();
    });
    Ok(ClaudeLoginSession { pid, auth_url })
}

/// `claude auth logout`; returns whether it exited 0.
pub fn logout(install: &ClaudeInstall) -> bool {
    let mut cmd = Command::new(&install.path);
    cmd.args(["auth", "logout"]);
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let result = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None);
    matches!(result, Ok((0, _, _)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_reads_logged_in_account() {
        let acct = parse_status(
            r#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.com","subscriptionType":"team"}"#,
        );
        assert!(acct.logged_in);
        assert_eq!(acct.email.as_deref(), Some("a@b.com"));
        assert_eq!(acct.subscription_type.as_deref(), Some("team"));
    }

    #[test]
    fn parse_status_handles_logged_out_and_garbage() {
        assert!(!parse_status(r#"{"loggedIn":false}"#).logged_in);
        assert!(!parse_status("not json at all").logged_in);
        assert!(!parse_status("").logged_in);
    }

    #[test]
    fn parse_auth_url_matches_anthropic_only() {
        assert_eq!(
            parse_auth_url("Visit: https://claude.ai/oauth/authorize?code=1).").as_deref(),
            Some("https://claude.ai/oauth/authorize?code=1"),
        );
        assert!(parse_auth_url("see https://example.com/help").is_none());
    }
}
