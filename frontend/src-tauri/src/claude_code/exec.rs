//! Execute one non-interactive `claude --print` call and return its text.
//!
//! Claude Code reads the prompt from stdin (immune to Windows' arg limit) and
//! prints the assistant's reply to stdout. This is a pure text completion — no
//! tools, no MCP configured on this invocation.
//! NOTE: flag names track the `claude` CLI; verify against `claude --help`
//! before hardening (doc 14 §4.2). A tool-disable flag can be added here once
//! confirmed; a plain `--print` prompt does not invoke tools.

use std::io::Write;
use std::process::{Command, Stdio};

use tokio_util::sync::CancellationToken;

use super::process::{creation_no_window, spawn_reader, tail, wait_with_deadline};
use super::{ClaudeCliError, ClaudeInstall, EXEC_TIMEOUT_SECS, TAIL_LIMIT};

/// Build the `claude` argument list (pure; unit-tested).
pub(crate) fn build_print_args() -> Vec<std::ffi::OsString> {
    vec!["--print".into(), "--output-format".into(), "text".into()]
}

fn stderr_signals_logged_out(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("not logged in")
        || lower.contains("please run")
        || lower.contains("/login")
        || lower.contains("401")
        || lower.contains("unauthorized")
        || lower.contains("authenticate")
}

/// Run `claude --print` once, feeding `prompt` on stdin.
pub fn exec_blocking(
    install: &ClaudeInstall,
    prompt: &str,
    cancel: Option<&CancellationToken>,
) -> Result<String, ClaudeCliError> {
    let mut cmd = Command::new(&install.path);
    cmd.args(build_print_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    creation_no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| ClaudeCliError::Spawn(e.to_string()))?;
    let stdin_handle = child.stdin.take().map(|mut stdin| {
        let prompt = prompt.to_string();
        std::thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
            // stdin drops → pipe closes → claude proceeds.
        })
    });
    let out = child.stdout.take().map(spawn_reader);
    let err = child.stderr.take().map(spawn_reader);

    let code = wait_with_deadline(child, EXEC_TIMEOUT_SECS, cancel)?;
    if let Some(h) = stdin_handle {
        let _ = h.join();
    }
    let stdout = out.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = err.and_then(|h| h.join().ok()).unwrap_or_default();

    if code != 0 {
        if stderr_signals_logged_out(&stderr) {
            return Err(ClaudeCliError::NotLoggedIn);
        }
        return Err(ClaudeCliError::NonZeroExit { code, stderr_tail: tail(&stderr, TAIL_LIMIT) });
    }
    let text = stdout.trim().to_string();
    if text.is_empty() {
        return Err(ClaudeCliError::BadOutput("claude produced no output".into()));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_args_shape() {
        let a: Vec<String> =
            build_print_args().iter().map(|s| s.to_string_lossy().into()).collect();
        assert_eq!(a[0], "--print");
        assert!(a.contains(&"text".to_string()));
    }

    #[test]
    fn logged_out_detection() {
        assert!(stderr_signals_logged_out("Error: not logged in"));
        assert!(stderr_signals_logged_out("please run /login"));
        assert!(!stderr_signals_logged_out("rate limit exceeded"));
    }

    #[cfg(windows)]
    #[test]
    fn exec_runs_fake_claude_cmd() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake_claude.cmd");
        // Echoes a fixed reply regardless of stdin.
        std::fs::write(&fake, "@echo off\r\necho fake reply\r\nexit /b 0\r\n").unwrap();
        let install = ClaudeInstall { path: fake, version: None };
        let out = exec_blocking(&install, "hello", None).expect("exec ok");
        assert_eq!(out, "fake reply");
    }
}
