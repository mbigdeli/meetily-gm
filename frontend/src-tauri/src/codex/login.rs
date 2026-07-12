//! `codex login` with auth-URL capture (Meetily-GM).
//!
//! `codex login` opens the browser itself, but the old approach spawned it
//! fully detached with every stdio stream nulled — so if that auto-open
//! silently failed, the printed fallback URL was thrown away and the user had
//! no recourse. This module runs the same login but captures codex's output,
//! recovers the OAuth URL, and hands it back so the app can open it reliably
//! and display it. The CLI still owns all tokens (`~/.codex/auth.json`).

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::Duration;

use super::CodexInstall;

/// How long to wait for codex to print its auth URL. Absence is not an error:
/// codex may open the browser without printing anything we recognise.
const URL_WAIT_SECS: u64 = 8;
/// Force-kill the login child if the OAuth callback never completes, so a
/// never-finished sign-in can't leak a long-lived process.
const LOGIN_DEADLINE_SECS: u64 = 300;

/// Outcome of launching `codex login`: the child pid plus the auth URL when
/// codex printed one (for the app to open and show as a fallback).
#[derive(Debug, Clone, serde::Serialize)]
pub struct LoginSession {
    pub pid: u32,
    pub auth_url: Option<String>,
}

/// Extract the OAuth authorize URL from one line of codex output.
///
/// Pure and unit-tested: finds the first `https://` token and keeps it only
/// when it looks like the OpenAI sign-in URL, trimming trailing punctuation.
pub fn parse_auth_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches(['.', ',', ')', '"', '\'', '>']);
    if url.contains("auth.openai.com") || url.contains("/oauth") {
        Some(url.to_string())
    } else {
        None
    }
}

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

/// Launch `codex login`, capturing its output to recover the auth URL.
///
/// The child is left running (codex hosts a localhost OAuth callback server)
/// and force-killed after [`LOGIN_DEADLINE_SECS`]. Both stdout and stderr are
/// drained on background threads so codex never blocks on a full pipe, and the
/// first recognised URL is returned (or `None` after [`URL_WAIT_SECS`]).
pub fn spawn_login_capture(install: &CodexInstall) -> Result<LoginSession, String> {
    let mut cmd = Command::new(&install.path);
    cmd.arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    creation_no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    let (tx, rx) = channel::<String>();
    if let Some(out) = child.stdout.take() {
        let tx = tx.clone();
        thread::spawn(move || scan_for_url(out, tx));
    }
    if let Some(err) = child.stderr.take() {
        thread::spawn(move || scan_for_url(err, tx));
    }
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(LOGIN_DEADLINE_SECS));
        let _ = child.kill();
        let _ = child.wait();
    });

    let auth_url = rx.recv_timeout(Duration::from_secs(URL_WAIT_SECS)).ok();
    Ok(LoginSession { pid, auth_url })
}

/// Read a stream line-by-line, sending the first auth URL found, then keep
/// draining to EOF so the child's output pipe never fills and blocks codex.
fn scan_for_url<R: std::io::Read>(stream: R, tx: Sender<String>) {
    let mut sent = false;
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        if !sent {
            if let Some(url) = parse_auth_url(&line) {
                let _ = tx.send(url);
                sent = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_auth_url;

    #[test]
    fn parses_the_printed_fallback_line() {
        let line = "  If your browser did not open, navigate to this URL to \
                    authenticate: https://auth.openai.com/oauth/authorize?client_id=abc&x=1";
        assert_eq!(
            parse_auth_url(line).as_deref(),
            Some("https://auth.openai.com/oauth/authorize?client_id=abc&x=1"),
        );
    }

    #[test]
    fn trims_trailing_punctuation() {
        let line = "visit (https://auth.openai.com/oauth/authorize?a=1).";
        assert_eq!(
            parse_auth_url(line).as_deref(),
            Some("https://auth.openai.com/oauth/authorize?a=1"),
        );
    }

    #[test]
    fn ignores_unrelated_urls() {
        assert!(parse_auth_url("see https://example.com/docs for help").is_none());
        assert!(parse_auth_url("no url here at all").is_none());
    }
}
