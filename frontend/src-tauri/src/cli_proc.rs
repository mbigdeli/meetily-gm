//! Minimal blocking child-process runner used by the model-catalog code
//! (codex + claude model fetch/probes). Kept standalone so the existing
//! per-provider exec paths stay untouched. Callers run it on the blocking
//! pool (`spawn_blocking`); a hard deadline kills the child on timeout.

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const WAIT_POLL_INTERVAL_MS: u64 = 250;

/// Suppress the console window that would otherwise flash on Windows.
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

/// Drain a child stream into a String on a thread (prevents pipe deadlock).
fn spawn_reader<R: std::io::Read + Send + 'static>(stream: R) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = std::io::BufReader::new(stream);
        let _ = std::io::Read::read_to_string(&mut reader, &mut buf);
        buf
    })
}

/// Run `cmd` feeding `stdin_data`, capture stdout/stderr, kill at the
/// deadline. Returns `(exit_code, stdout, stderr)`; `Err` only for spawn
/// failures and timeouts.
pub(crate) fn run_with_stdin(
    mut cmd: Command,
    stdin_data: &str,
    timeout_secs: u64,
) -> Result<(i32, String, String), String> {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdin_handle = child.stdin.take().map(|mut stdin| {
        let data = stdin_data.to_string();
        std::thread::spawn(move || {
            let _ = stdin.write_all(data.as_bytes());
            // stdin drops here, closing the pipe so the CLI starts working.
        })
    });
    let out_handle = child.stdout.take().map(spawn_reader);
    let err_handle = child.stderr.take().map(spawn_reader);

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("timed out after {timeout_secs}s"));
                }
                std::thread::sleep(Duration::from_millis(WAIT_POLL_INTERVAL_MS));
            }
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    };

    if let Some(h) = stdin_handle {
        let _ = h.join();
    }
    let stdout = out_handle.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = err_handle.and_then(|h| h.join().ok()).unwrap_or_default();
    Ok((code, stdout, stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn runs_a_fake_cmd_and_captures_output() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake.cmd");
        std::fs::write(&fake, "@echo off\r\necho hello out\r\nexit /b 3\r\n").unwrap();
        let cmd = Command::new(&fake);
        let (code, out, _err) = run_with_stdin(cmd, "ignored", 30).expect("runs");
        assert_eq!(code, 3);
        assert_eq!(out.trim(), "hello out");
    }

    #[cfg(windows)]
    #[test]
    fn kills_on_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("slow.cmd");
        // Pure-batch spin: external commands (ping/timeout) may be missing
        // from the child's PATH under the test harness.
        std::fs::write(&fake, "@echo off\r\n:loop\r\ngoto loop\r\n").unwrap();
        let cmd = Command::new(&fake);
        let err = run_with_stdin(cmd, "", 1).unwrap_err();
        assert!(err.contains("timed out"), "got: {err}");
    }
}
