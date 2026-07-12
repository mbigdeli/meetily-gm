//! OpenAI Codex CLI integration (Meetily-GM addition).
//!
//! Runs AI summarization through the locally installed Codex CLI, which
//! authenticates with the user's ChatGPT subscription (`codex login`) — no
//! API key, no per-token billing. This module resolves the CLI binary,
//! inspects sign-in state, and executes one-shot non-interactive
//! `codex exec` calls. The CLI owns all tokens (`~/.codex/auth.json`);
//! nothing secret is stored by this app.
//!
//! Ported from the GMeet MOM project's `pipeline/codex_cli.rs`
//! (github.com/mbigdeli/google-meet-summary), where this design was
//! verified end-to-end on real meetings.

pub mod commands;
pub mod login;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

/// When set, this path is the only Codex binary considered (also the test hook).
pub const CODEX_EXE_ENV: &str = "MEETILY_CODEX_EXE";

/// Generous ceiling per exec call; codex summaries typically take 15-90 s.
pub const EXEC_TIMEOUT_SECS: u64 = 600;
const STATUS_TIMEOUT_SECS: u64 = 15;
const WAIT_POLL_INTERVAL_MS: u64 = 250;
const TAIL_LIMIT: usize = 16 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum CodexCliError {
    #[error("codex_cli_not_installed")]
    NotInstalled,
    #[error("codex_not_logged_in")]
    NotLoggedIn,
    #[error("codex exec timed out after {0}s")]
    Timeout(u64),
    #[error("codex exec was cancelled")]
    Cancelled,
    #[error("codex spawn failed: {0}")]
    Spawn(String),
    #[error("codex exited with code {code}: {stderr_tail}")]
    NonZeroExit { code: i32, stderr_tail: String },
    #[error("codex output invalid: {0}")]
    BadOutput(String),
}

/// A resolved Codex CLI installation.
#[derive(Debug, Clone)]
pub struct CodexInstall {
    pub path: PathBuf,
    pub version: Option<String>,
}

/// Best-effort account info read from `$CODEX_HOME/auth.json`.
#[derive(Debug, Clone, Default)]
pub struct CodexAccount {
    pub email: Option<String>,
    pub account_id: Option<String>,
    pub method: Option<String>,
}

/// The Tauri app is long-lived, so an in-process cache is enough
/// (the old native-messaging host needed a disk cache; we don't).
static INSTALL_CACHE: OnceLock<CodexInstall> = OnceLock::new();

fn creation_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Rank a candidate by how safely Windows can spawn it.
///
/// npm installs put an extensionless POSIX shim named `codex` next to
/// `codex.cmd`; `where codex` lists the shim FIRST, and spawning it fails
/// with "not a valid Win32 application" (error 193). Only spawnable
/// extensions qualify on Windows: `.exe` best, then `.cmd`, then `.bat`.
fn spawn_rank(path: &Path) -> Option<u8> {
    if !cfg!(windows) {
        return Some(0);
    }
    let ext = path.extension()?.to_str()?;
    match ext.to_ascii_lowercase().as_str() {
        "exe" => Some(0),
        "cmd" => Some(1),
        "bat" => Some(2),
        _ => None,
    }
}

/// Pick the most spawnable candidate (pure; unit-tested).
fn pick_best_candidate(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .filter_map(|p| spawn_rank(p).map(|rank| (rank, p)))
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, p)| p.clone())
}

/// Query `codex --version`, best-effort.
fn query_version(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let (code, stdout, _stderr) = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None).ok()?;
    if code != 0 {
        return None;
    }
    let v = stdout.trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

/// `where codex` (Windows) / `which codex` results, filtered to spawnable candidates.
fn resolve_via_lookup() -> Option<PathBuf> {
    let lookup = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(lookup);
    cmd.arg("codex")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let (code, stdout, _stderr) = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None).ok()?;
    if code != 0 {
        return None;
    }
    let candidates: Vec<PathBuf> = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect();
    pick_best_candidate(&candidates)
}

fn known_install_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        out.push(PathBuf::from(&appdata).join("npm").join("codex.exe"));
        out.push(PathBuf::from(&appdata).join("npm").join("codex.cmd"));
    }
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".cargo").join("bin").join("codex.exe"));
        out.push(home.join(".local").join("bin").join("codex"));
    }
    out.push(PathBuf::from("/usr/local/bin/codex"));
    out.push(PathBuf::from("/opt/homebrew/bin/codex"));
    out
}

/// Resolve the Codex CLI binary.
///
/// Order: env override (authoritative when set — no caching so tests stay
/// hermetic), in-process cache, `where`/`which`, known install locations.
pub fn resolve_codex_binary() -> Result<CodexInstall, CodexCliError> {
    if let Some(overridden) = std::env::var_os(CODEX_EXE_ENV) {
        let path = PathBuf::from(overridden);
        if path.is_file() {
            return Ok(CodexInstall {
                version: query_version(&path),
                path,
            });
        }
        return Err(CodexCliError::NotInstalled);
    }

    if let Some(cached) = INSTALL_CACHE.get() {
        if cached.path.is_file() {
            return Ok(cached.clone());
        }
    }

    let found =
        resolve_via_lookup().or_else(|| known_install_paths().into_iter().find(|p| p.is_file()));

    match found {
        Some(path) => {
            let install = CodexInstall {
                version: query_version(&path),
                path,
            };
            let _ = INSTALL_CACHE.set(install.clone());
            log::info!(
                "codex CLI resolved: {} ({:?})",
                install.path.display(),
                install.version
            );
            Ok(install)
        }
        None => Err(CodexCliError::NotInstalled),
    }
}

/// `codex login status` — exit code 0 means signed in.
pub fn login_status(install: &CodexInstall) -> Result<bool, CodexCliError> {
    let mut cmd = Command::new(&install.path);
    cmd.args(["login", "status"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let (code, _stdout, _stderr) = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None)?;
    Ok(code == 0)
}

/// Directory codex stores its state in (`CODEX_HOME` or `~/.codex`).
fn codex_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("CODEX_HOME") {
        return Some(PathBuf::from(home));
    }
    dirs::home_dir().map(|h| h.join(".codex"))
}

/// Decode a JWT payload (no signature verification; display-only).
fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
    use base64::Engine;

    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Best-effort account info from codex's own `auth.json`. Never fails hard.
pub fn read_account_info() -> Option<CodexAccount> {
    let auth_path = codex_home()?.join("auth.json");
    let raw = std::fs::read_to_string(auth_path).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&raw).ok()?;

    let method = doc
        .get("auth_mode")
        .and_then(|v| v.as_str())
        .map(String::from);
    let tokens = doc.get("tokens");
    let account_id = tokens
        .and_then(|t| t.get("account_id"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let email = tokens
        .and_then(|t| t.get("id_token"))
        .and_then(|v| v.as_str())
        .and_then(decode_jwt_payload)
        .and_then(|claims| {
            claims
                .get("email")
                .and_then(|v| v.as_str())
                .map(String::from)
        });

    Some(CodexAccount {
        email,
        account_id,
        method,
    })
}

/// Run `codex logout`; returns whether it exited 0.
pub fn logout(install: &CodexInstall) -> Result<bool, CodexCliError> {
    let mut cmd = Command::new(&install.path);
    cmd.arg("logout")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let (code, _stdout, _stderr) = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None)?;
    Ok(code == 0)
}

/// Combined gate: binary resolves AND user is signed in.
pub fn preflight() -> Result<CodexInstall, CodexCliError> {
    let install = resolve_codex_binary()?;
    if login_status(&install)? {
        Ok(install)
    } else {
        Err(CodexCliError::NotLoggedIn)
    }
}

/// Drain a child stream into a String on a thread (prevents pipe deadlock).
fn spawn_reader<R: std::io::Read + Send + 'static>(stream: R) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = std::io::BufReader::new(stream);
        let _ = std::io::Read::read_to_string(&mut reader, &mut buf);
        buf
    })
}

/// Wait for a child with a kill-deadline and optional cancellation.
fn wait_with_deadline(
    mut child: Child,
    timeout_secs: u64,
    cancel: Option<&CancellationToken>,
) -> Result<i32, CodexCliError> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if let Some(token) = cancel {
            if token.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CodexCliError::Cancelled);
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.code().unwrap_or(-1)),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CodexCliError::Timeout(timeout_secs));
                }
                std::thread::sleep(Duration::from_millis(WAIT_POLL_INTERVAL_MS));
            }
            Err(e) => return Err(CodexCliError::Spawn(format!("wait failed: {e}"))),
        }
    }
}

/// Run a command to completion, capturing stdout/stderr.
fn run_to_completion(
    mut cmd: Command,
    timeout_secs: u64,
    cancel: Option<&CancellationToken>,
) -> Result<(i32, String, String), CodexCliError> {
    let mut child = cmd
        .spawn()
        .map_err(|e| CodexCliError::Spawn(e.to_string()))?;
    let stdout_handle = child.stdout.take().map(spawn_reader);
    let stderr_handle = child.stderr.take().map(spawn_reader);
    let code = wait_with_deadline(child, timeout_secs, cancel)?;
    let stdout = stdout_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    let stderr = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    Ok((code, stdout, stderr))
}

fn tail(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    let start = s.len() - limit;
    let mut idx = start;
    while !s.is_char_boundary(idx) {
        idx += 1;
    }
    s[idx..].to_string()
}

fn stderr_signals_logged_out(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("not logged in")
        || lower.contains("please run `codex login`")
        || lower.contains("401")
        || lower.contains("unauthorized")
}

/// Build the `codex exec` argument list (pure; unit-tested).
fn build_exec_args(workdir: &Path, include_optional: bool) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec![
        "exec".into(),
        "--skip-git-repo-check".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--color".into(),
        "never".into(),
        "-C".into(),
        workdir.as_os_str().to_os_string(),
        "--output-last-message".into(),
        workdir.join("codex_last_message.txt").into_os_string(),
    ];
    if include_optional {
        args.push("--ephemeral".into());
    }
    // Read the full prompt from stdin (immune to Windows' 32K argument limit).
    args.push("-".into());
    args
}

fn run_exec_once(
    install: &CodexInstall,
    prompt: &str,
    workdir: &Path,
    include_optional: bool,
    cancel: Option<&CancellationToken>,
) -> Result<(i32, String, String), CodexCliError> {
    let mut cmd = Command::new(&install.path);
    cmd.args(build_exec_args(workdir, include_optional))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| CodexCliError::Spawn(e.to_string()))?;

    let stdin_handle = child.stdin.take().map(|mut stdin| {
        let prompt = prompt.to_string();
        std::thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
            // stdin drops here, closing the pipe so codex starts.
        })
    });
    let stdout_handle = child.stdout.take().map(spawn_reader);
    let stderr_handle = child.stderr.take().map(spawn_reader);

    let code = wait_with_deadline(child, EXEC_TIMEOUT_SECS, cancel)?;

    if let Some(h) = stdin_handle {
        let _ = h.join();
    }
    let stdout = stdout_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    let stderr = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    Ok((code, stdout, stderr))
}

/// Run one non-interactive `codex exec` and return the final message text.
///
/// Blocking — call via `tokio::task::spawn_blocking` from async contexts.
pub fn exec_blocking(
    install: &CodexInstall,
    prompt: &str,
    workdir: &Path,
    cancel: Option<&CancellationToken>,
) -> Result<String, CodexCliError> {
    let last_message_path = workdir.join("codex_last_message.txt");
    let _ = std::fs::remove_file(&last_message_path);

    let (mut code, mut stdout, mut stderr) = run_exec_once(install, prompt, workdir, true, cancel)?;

    // Older CLI versions may not know --ephemeral; retry once without it.
    if code == 2 && stderr.to_ascii_lowercase().contains("unexpected argument") {
        log::warn!("codex exec rejected optional flags; retrying without them");
        (code, stdout, stderr) = run_exec_once(install, prompt, workdir, false, cancel)?;
    }

    if code != 0 {
        if stderr_signals_logged_out(&stderr) {
            return Err(CodexCliError::NotLoggedIn);
        }
        return Err(CodexCliError::NonZeroExit {
            code,
            stderr_tail: tail(&stderr, TAIL_LIMIT),
        });
    }

    let last_message = std::fs::read_to_string(&last_message_path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| stdout.trim().to_string());
    let _ = std::fs::remove_file(&last_message_path);

    if last_message.is_empty() {
        return Err(CodexCliError::BadOutput(
            "codex produced no final message".into(),
        ));
    }
    Ok(last_message)
}

/// Async summary entry point used by the LLM client.
///
/// Codex has a single prompt channel, so the system prompt is inlined ahead
/// of the user prompt. Runs in `spawn_blocking`; honors the cancellation
/// token (kills the codex child process on cancel).
pub async fn generate_with_codex(
    app_data_dir: &Path,
    system_prompt: &str,
    user_prompt: &str,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    let install = tokio::task::block_in_place(preflight).map_err(|e| match e {
        CodexCliError::NotInstalled => {
            "Codex CLI is not installed. Install Node.js, then run: npm i -g @openai/codex"
                .to_string()
        }
        CodexCliError::NotLoggedIn => {
            "Codex CLI is not signed in. Use 'Sign in with ChatGPT' in Settings (or run `codex login`)."
                .to_string()
        }
        other => other.to_string(),
    })?;

    let workdir = app_data_dir.join("codex_work");
    std::fs::create_dir_all(&workdir).map_err(|e| format!("create codex workdir: {e}"))?;

    let prompt = format!("{system_prompt}\n\n{user_prompt}");
    let token = cancellation_token.cloned();

    let result = tokio::task::spawn_blocking(move || {
        exec_blocking(&install, &prompt, &workdir, token.as_ref())
    })
    .await
    .map_err(|e| format!("codex task join error: {e}"))?;

    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    /// Env vars are process-global while tests run in parallel — one lock.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        old: Option<std::ffi::OsString>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let old = std::env::var_os(key);
            std::env::set_var(key, value);
            Self {
                key,
                old,
                _lock: lock,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            if let Some(old) = self.old.take() {
                std::env::set_var(self.key, old);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn env_override_with_missing_path_is_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope").join("codex.exe");
        let _guard = EnvGuard::set(CODEX_EXE_ENV, &missing);
        assert!(matches!(
            resolve_codex_binary(),
            Err(CodexCliError::NotInstalled)
        ));
    }

    #[cfg(windows)]
    #[test]
    fn pick_best_candidate_skips_extensionless_shim() {
        let candidates = vec![
            PathBuf::from("C:\\Users\\x\\AppData\\Roaming\\npm\\codex"),
            PathBuf::from("C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd"),
        ];
        assert_eq!(
            pick_best_candidate(&candidates),
            Some(PathBuf::from("C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn pick_best_candidate_prefers_exe_over_cmd() {
        let candidates = vec![
            PathBuf::from("C:\\a\\codex.cmd"),
            PathBuf::from("C:\\b\\codex.exe"),
        ];
        assert_eq!(
            pick_best_candidate(&candidates),
            Some(PathBuf::from("C:\\b\\codex.exe"))
        );
    }

    #[test]
    fn build_exec_args_shape() {
        let args = build_exec_args(Path::new("C:\\w"), true);
        let strs: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(strs[0], "exec");
        assert!(strs.contains(&"--skip-git-repo-check".to_string()));
        assert!(strs.contains(&"--ephemeral".to_string()));
        assert_eq!(strs.last().unwrap(), "-");

        let without: Vec<String> = build_exec_args(Path::new("C:\\w"), false)
            .iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(!without.contains(&"--ephemeral".to_string()));
    }

    #[test]
    fn read_account_info_parses_fixture_auth_json() {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;

        let dir = tempfile::tempdir().unwrap();
        let claims = URL_SAFE_NO_PAD.encode(r#"{"email":"user@example.com"}"#);
        let id_token = format!("hdr.{claims}.sig");
        let auth = serde_json::json!({
            "auth_mode": "chatgpt",
            "tokens": { "id_token": id_token, "account_id": "acct-123" },
        });
        std::fs::write(
            dir.path().join("auth.json"),
            serde_json::to_string(&auth).unwrap(),
        )
        .unwrap();

        let _guard = EnvGuard::set("CODEX_HOME", dir.path());
        let info = read_account_info().expect("account info");
        assert_eq!(info.email.as_deref(), Some("user@example.com"));
        assert_eq!(info.account_id.as_deref(), Some("acct-123"));
        assert_eq!(info.method.as_deref(), Some("chatgpt"));
    }

    #[cfg(windows)]
    #[test]
    fn exec_blocking_runs_fake_codex_cmd() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake_codex.cmd");
        std::fs::write(&fake, "@echo off\r\necho fake summary\r\nexit /b 0\r\n").unwrap();
        let workdir = dir.path().join("work");
        std::fs::create_dir_all(&workdir).unwrap();

        let _guard = EnvGuard::set(CODEX_EXE_ENV, &fake);
        let install = resolve_codex_binary().expect("fake codex resolves");
        let out = exec_blocking(&install, "hello", &workdir, None).expect("exec ok");
        assert_eq!(out, "fake summary");
    }
}
