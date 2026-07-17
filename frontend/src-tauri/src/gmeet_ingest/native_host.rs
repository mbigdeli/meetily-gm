//! Registers the native-messaging host so Chrome/Edge can launch
//! `miting-pairing-host` for the pinned companion extension (doc 15 §4:
//! identity-based pairing — `allowed_origins` is the authorization, no secret
//! shown to the user). Best-effort at startup: failures are logged, never fatal.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use tauri::{AppHandle, Manager, Runtime};

pub const HOST_NAME: &str = "com.meetingcapture.host";
/// Stable ID derived from the fixed `key` in extension/manifest.json.
const EXTENSION_ORIGIN: &str = "chrome-extension://abggedoehnlmbcapbfdikhhnkcckhfck/";
/// HKCU (per-user, no elevation) registry roots per Chromium browser.
#[cfg(target_os = "windows")]
const BROWSER_REGISTRY_ROOTS: [&str; 2] = [
    r"Software\Google\Chrome\NativeMessagingHosts",
    r"Software\Microsoft\Edge\NativeMessagingHosts",
];

fn manifest_json(host_exe: &Path) -> serde_json::Value {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "Miting companion pairing host",
        "path": host_exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [EXTENSION_ORIGIN],
    })
}

/// The pairing-host sidecar ships next to the app executable (tauri externalBin).
fn host_exe_path() -> Result<PathBuf> {
    let dir = std::env::current_exe()
        .context("resolve current exe")?
        .parent()
        .ok_or_else(|| anyhow!("app exe has no parent dir"))?
        .to_path_buf();
    let exe = dir.join(if cfg!(windows) { "miting-pairing-host.exe" } else { "miting-pairing-host" });
    if !exe.is_file() {
        return Err(anyhow!("pairing host binary not found at {}", exe.display()));
    }
    Ok(exe)
}

/// Write the host manifest into app-data and point browser registries at it.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let host_exe = host_exe_path()?;
    let dir = app
        .path()
        .app_data_dir()
        .context("resolve app data dir")?
        .join("native-host");
    std::fs::create_dir_all(&dir).context("create native-host dir")?;
    let manifest_path = dir.join(format!("{HOST_NAME}.json"));
    let manifest = serde_json::to_string_pretty(&manifest_json(&host_exe))?;
    std::fs::write(&manifest_path, manifest).context("write host manifest")?;

    #[cfg(target_os = "windows")]
    register_windows(&manifest_path)?;

    log::info!(
        "native-messaging host registered: {} -> {}",
        HOST_NAME,
        manifest_path.display()
    );
    Ok(manifest_path)
}

#[cfg(target_os = "windows")]
fn register_windows(manifest_path: &Path) -> Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for root in BROWSER_REGISTRY_ROOTS {
        let (key, _) = hkcu
            .create_subkey(format!(r"{root}\{HOST_NAME}"))
            .with_context(|| format!("create registry key under {root}"))?;
        key.set_value("", &manifest_path.to_string_lossy().to_string())
            .with_context(|| format!("set manifest path under {root}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_pins_the_extension_and_uses_stdio() {
        let m = manifest_json(Path::new(r"C:\apps\miting-pairing-host.exe"));
        assert_eq!(m["name"], HOST_NAME);
        assert_eq!(m["type"], "stdio");
        let origins = m["allowed_origins"].as_array().unwrap();
        assert_eq!(origins.len(), 1, "exactly one pinned extension origin");
        let origin = origins[0].as_str().unwrap();
        assert!(origin.starts_with("chrome-extension://"));
        assert!(origin.ends_with('/'), "Chrome requires a trailing slash");
        assert!(m["path"].as_str().unwrap().contains("miting-pairing-host"));
    }
}
