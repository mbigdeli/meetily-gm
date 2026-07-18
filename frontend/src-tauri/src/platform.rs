//! Small OS integration helpers.

/// Open an http(s) URL in the user's default browser (e.g. the Slack app
/// creator or an API-token page). Tiny + dependency-free; Windows-first.
/// Callers pass fixed, app-authored URLs only — never raw LLM output.
#[tauri::command]
pub fn api_open_external(url: String) -> Result<(), String> {
    open_external_url(&url)
}

/// Reusable helper (also used by the Slack OAuth flow): validate scheme + open.
pub fn open_external_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened.".into());
    }
    open_url(url)
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> Result<(), String> {
    // NOT `cmd /C start` — cmd.exe re-parses the whole command line itself and
    // treats an unquoted `&` as a command separator, silently truncating any
    // URL with more than one query parameter (e.g. every OAuth authorize URL).
    // rundll32 takes the URL as a plain argv entry with no shell re-parsing.
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Prepend the Node.js install directory to a child command's `PATH`.
///
/// The npm CLI shims (`codex.cmd`, `claude.cmd`) invoke a bare `node`, which
/// fails with "'node' is not recognized" when the app was launched from a shell
/// whose PATH `cmd.exe` cannot use (e.g. Git Bash's POSIX-style PATH, or an nvm
/// shell). Prepending the real Node directory makes the shim resolve `node`
/// regardless of how the app was started. No-op off Windows or when Node isn't
/// found (the child then falls back to its inherited PATH).
pub fn ensure_node_on_path(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        let dir = node_install_dir();
        if dir.is_none() {
            log::warn!("ensure_node_on_path: no Node.js install dir found; npm shims may fail");
        }
        if let Some(dir) = dir {
            let mut path = std::ffi::OsString::from(dir);
            if let Some(existing) = std::env::var_os("PATH") {
                path.push(";");
                path.push(existing);
            }
            cmd.env("PATH", path);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[cfg(windows)]
fn node_install_dir() -> Option<std::path::PathBuf> {
    // The standard installer and nvm-windows both expose node.exe here.
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(pf) = std::env::var_os(var) {
            let dir = std::path::PathBuf::from(pf).join("nodejs");
            if dir.join("node.exe").is_file() {
                return Some(dir);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn ensure_node_on_path_prepends_when_node_present() {
        let Some(dir) = node_install_dir() else {
            return; // no Node on this machine; nothing to assert
        };
        let mut c = std::process::Command::new("cmd");
        ensure_node_on_path(&mut c);
        let path = c
            .get_envs()
            .find(|(k, _)| k.to_string_lossy().eq_ignore_ascii_case("PATH"))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or_default();
        assert!(path.starts_with(&dir.to_string_lossy().to_string()));
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(api_open_external("file:///etc/passwd".into()).is_err());
        assert!(api_open_external("javascript:alert(1)".into()).is_err());
    }
}
