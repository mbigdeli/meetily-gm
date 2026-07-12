//! Resolve the Claude Code CLI (`claude`) binary. Mirrors the codex resolver,
//! including the Windows POSIX-shim guard (npm installs an extensionless
//! `claude` next to `claude.cmd`; spawning the shim fails with error 193).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use super::process::{creation_no_window, run_to_completion};
use super::{ClaudeCliError, ClaudeInstall, CLAUDE_EXE_ENV, STATUS_TIMEOUT_SECS};

static INSTALL_CACHE: OnceLock<ClaudeInstall> = OnceLock::new();

/// Rank a candidate by how safely Windows can spawn it (`.exe` < `.cmd` < `.bat`);
/// `None` = not spawnable (e.g. the extensionless npm shim). Pure; unit-tested.
fn spawn_rank(path: &Path) -> Option<u8> {
    if !cfg!(windows) {
        return Some(0);
    }
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "exe" => Some(0),
        "cmd" => Some(1),
        "bat" => Some(2),
        _ => None,
    }
}

fn pick_best_candidate(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .filter_map(|p| spawn_rank(p).map(|rank| (rank, p)))
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, p)| p.clone())
}

fn query_version(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version").stdin(Stdio::null());
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let (code, stdout, _) = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None).ok()?;
    if code != 0 {
        return None;
    }
    let v = stdout.trim();
    (!v.is_empty()).then(|| v.to_string())
}

fn resolve_via_lookup() -> Option<PathBuf> {
    let lookup = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(lookup);
    cmd.arg("claude");
    creation_no_window(&mut cmd);
    crate::platform::ensure_node_on_path(&mut cmd);
    let (code, stdout, _) = run_to_completion(cmd, STATUS_TIMEOUT_SECS, None).ok()?;
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
        out.push(PathBuf::from(&appdata).join("npm").join("claude.exe"));
        out.push(PathBuf::from(&appdata).join("npm").join("claude.cmd"));
    }
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".local").join("bin").join("claude"));
    }
    out.push(PathBuf::from("/usr/local/bin/claude"));
    out.push(PathBuf::from("/opt/homebrew/bin/claude"));
    out
}

/// Resolve the `claude` binary. Order: env override (authoritative + test hook,
/// never cached), in-process cache, `where`/`which`, known install locations.
pub fn resolve_claude_binary() -> Result<ClaudeInstall, ClaudeCliError> {
    if let Some(overridden) = std::env::var_os(CLAUDE_EXE_ENV) {
        let path = PathBuf::from(overridden);
        if path.is_file() {
            return Ok(ClaudeInstall { version: query_version(&path), path });
        }
        return Err(ClaudeCliError::NotInstalled);
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
            let install = ClaudeInstall { version: query_version(&path), path };
            let _ = INSTALL_CACHE.set(install.clone());
            log::info!("claude CLI resolved: {}", install.path.display());
            Ok(install)
        }
        None => Err(ClaudeCliError::NotInstalled),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn skips_extensionless_shim_prefers_cmd() {
        let c = vec![PathBuf::from("C:\\npm\\claude"), PathBuf::from("C:\\npm\\claude.cmd")];
        assert_eq!(pick_best_candidate(&c), Some(PathBuf::from("C:\\npm\\claude.cmd")));
    }

    #[cfg(windows)]
    #[test]
    fn prefers_exe_over_cmd() {
        let c = vec![PathBuf::from("C:\\a\\claude.cmd"), PathBuf::from("C:\\b\\claude.exe")];
        assert_eq!(pick_best_candidate(&c), Some(PathBuf::from("C:\\b\\claude.exe")));
    }
}
