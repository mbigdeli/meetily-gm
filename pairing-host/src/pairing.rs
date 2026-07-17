//! Pairing payload: the ingest base URL + per-install token.
//!
//! Reads (or mints, first run) the SAME token file the desktop app's ingest
//! server uses — `gmeet_ingest::load_or_create_token` in the app — so whichever
//! side runs first, both ends agree. Format mirrors the app: 64 hex chars.

use std::path::PathBuf;

pub const BASE_URL: &str = "http://127.0.0.1:5167";
const TOKEN_FILE: &str = "gmeet_pairing_token.txt";
/// Test hook: overrides the app-data directory the token file lives in.
pub const DIR_ENV_OVERRIDE: &str = "MITING_PAIRING_DIR";

fn token_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var(DIR_ENV_OVERRIDE) {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    // Tauri's app_data_dir for identifier li.bigde.miting on Windows.
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("li.bigde.miting"))
}

fn mint_token() -> String {
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")
}

/// Load the shared pairing token, creating and persisting one on first run.
pub fn load_or_create_token() -> std::io::Result<String> {
    let dir = token_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "no app-data directory")
    })?;
    let path = dir.join(TOKEN_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let token = mint_token();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&path, &token)?;
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DirGuard;
    impl Drop for DirGuard {
        fn drop(&mut self) {
            std::env::remove_var(DIR_ENV_OVERRIDE);
        }
    }

    #[test]
    fn reads_existing_token_and_mints_when_absent() {
        let tmp = std::env::temp_dir().join(format!("pairing-host-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var(DIR_ENV_OVERRIDE, &tmp);
        let _guard = DirGuard;

        let minted = load_or_create_token().unwrap();
        assert_eq!(minted.len(), 64, "app token format is 64 hex chars");
        let reread = load_or_create_token().unwrap();
        assert_eq!(minted, reread, "second read returns the persisted token");

        std::fs::write(tmp.join(TOKEN_FILE), "  fixed-token\n").unwrap();
        assert_eq!(load_or_create_token().unwrap(), "fixed-token", "existing file wins, trimmed");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
