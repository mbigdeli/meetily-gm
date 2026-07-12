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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_schemes() {
        assert!(api_open_external("file:///etc/passwd".into()).is_err());
        assert!(api_open_external("javascript:alert(1)".into()).is_err());
    }
}
