//! One-time data-dir migration for the Miting identifier change.
//!
//! Renaming the bundle identifier (`com.meetily.ai` → `li.bigde.miting`) moves
//! the Tauri `app_data_dir`. On first launch under the new id, if no DB exists
//! yet, copy the meetings DB from a previous identifier's sibling dir. Whisper
//! models are large and re-downloadable, so they are NOT migrated (re-download
//! or copy `models/` by hand). Best-effort: logs and never aborts startup.
//! First real launch should be watched in the logs to confirm this fired.

use std::path::{Path, PathBuf};

/// Previous app-data dir names to search (newest-preference first).
const LEGACY_DIR_NAMES: [&str; 2] = ["com.meetily.ai", "Meetily"];
const DB_FILES: [&str; 2] = ["meeting_minutes.sqlite", "meeting_minutes.db"];

/// If neither `new_sqlite` nor `new_db` exists yet, copy the first meetings DB
/// found in a sibling legacy dir into the matching destination. Returns the
/// source path if a migration happened.
pub fn migrate_meetings_db(
    new_app_data_dir: &Path,
    new_sqlite: &Path,
    new_db: &Path,
) -> Option<PathBuf> {
    if new_sqlite.exists() || new_db.exists() {
        return None; // new dir already has data — nothing to migrate
    }
    let parent = new_app_data_dir.parent()?;
    for dir in LEGACY_DIR_NAMES {
        let legacy = parent.join(dir);
        if !legacy.is_dir() {
            continue;
        }
        for f in DB_FILES {
            let src = legacy.join(f);
            if !src.is_file() {
                continue;
            }
            // .sqlite → new .sqlite; .db → new .db (manager then imports .db→.sqlite).
            let dest = if f.ends_with(".sqlite") { new_sqlite } else { new_db };
            match std::fs::copy(&src, dest) {
                Ok(_) => {
                    log::info!("migrated meetings DB from {}", src.display());
                    return Some(src);
                }
                Err(e) => log::warn!("legacy DB copy failed ({}): {}", src.display(), e),
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_migration_when_new_db_present() {
        let tmp = std::env::temp_dir().join("miting_mig_present");
        let _ = std::fs::remove_dir_all(&tmp);
        let new_dir = tmp.join("li.bigde.miting");
        std::fs::create_dir_all(&new_dir).unwrap();
        let new_sqlite = new_dir.join("meeting_minutes.sqlite");
        std::fs::write(&new_sqlite, b"existing").unwrap();
        let new_db = new_dir.join("meeting_minutes.db");
        assert_eq!(migrate_meetings_db(&new_dir, &new_sqlite, &new_db), None);
    }

    #[test]
    fn copies_sqlite_from_legacy_sibling() {
        let tmp = std::env::temp_dir().join("miting_mig_copy");
        let _ = std::fs::remove_dir_all(&tmp);
        let legacy = tmp.join("com.meetily.ai");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("meeting_minutes.sqlite"), b"old-data").unwrap();
        let new_dir = tmp.join("li.bigde.miting");
        std::fs::create_dir_all(&new_dir).unwrap();
        let new_sqlite = new_dir.join("meeting_minutes.sqlite");
        let new_db = new_dir.join("meeting_minutes.db");

        let from = migrate_meetings_db(&new_dir, &new_sqlite, &new_db);
        assert!(from.is_some());
        assert_eq!(std::fs::read(&new_sqlite).unwrap(), b"old-data");
    }
}
