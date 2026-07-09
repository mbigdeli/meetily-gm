//! Generic child-process helpers for the Claude Code CLI integration
//! (mirrors the codex module's process handling; kept separate so each file
//! stays small). Blocking; callers use `spawn_blocking` from async contexts.

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

use super::{ClaudeCliError, WAIT_POLL_INTERVAL_MS};

/// Suppress the console window that would otherwise flash on Windows.
pub(crate) fn creation_no_window(cmd: &mut Command) {
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

/// Drain a child stream into a String on a thread (prevents pipe deadlock).
pub(crate) fn spawn_reader<R: std::io::Read + Send + 'static>(
    stream: R,
) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = std::io::BufReader::new(stream);
        let _ = std::io::Read::read_to_string(&mut reader, &mut buf);
        buf
    })
}

/// Wait for a child with a kill-deadline and optional cancellation.
pub(crate) fn wait_with_deadline(
    mut child: Child,
    timeout_secs: u64,
    cancel: Option<&CancellationToken>,
) -> Result<i32, ClaudeCliError> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if let Some(token) = cancel {
            if token.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ClaudeCliError::Cancelled);
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.code().unwrap_or(-1)),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ClaudeCliError::Timeout(timeout_secs));
                }
                std::thread::sleep(Duration::from_millis(WAIT_POLL_INTERVAL_MS));
            }
            Err(e) => return Err(ClaudeCliError::Spawn(format!("wait failed: {e}"))),
        }
    }
}

/// Run a command to completion (no stdin), capturing stdout/stderr.
pub(crate) fn run_to_completion(
    mut cmd: Command,
    timeout_secs: u64,
    cancel: Option<&CancellationToken>,
) -> Result<(i32, String, String), ClaudeCliError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| ClaudeCliError::Spawn(e.to_string()))?;
    let out = child.stdout.take().map(spawn_reader);
    let err = child.stderr.take().map(spawn_reader);
    let code = wait_with_deadline(child, timeout_secs, cancel)?;
    let stdout = out.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = err.and_then(|h| h.join().ok()).unwrap_or_default();
    Ok((code, stdout, stderr))
}

/// Keep the last `limit` bytes of `s`, respecting char boundaries.
pub(crate) fn tail(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    let mut idx = s.len() - limit;
    while !s.is_char_boundary(idx) {
        idx += 1;
    }
    s[idx..].to_string()
}
