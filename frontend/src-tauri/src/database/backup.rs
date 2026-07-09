//! Pre-migration safety backup for the local SQLite database.
//!
//! Migrations are forward-only (`sqlx::migrate!`), so before applying any
//! pending migration we snapshot the existing DB file. If a migration or a
//! new app version corrupts data, the user can restore the last good copy.
//! See `.claude/skills/db-migrations/SKILL.md` for the restore runbook.

use sqlx::{Row, SqlitePool};
use std::fs;
use std::path::{Path, PathBuf};

/// Keep at most this many rolling backups; oldest are pruned.
const MAX_BACKUPS: usize = 5;

/// Back up `db_path` into a `backups/` sibling dir **iff** the embedded
/// migrator has versions newer than what the DB has already applied.
///
/// No-ops for a fresh DB (nothing to lose) and when fully up to date.
/// Backup failures are logged but never abort startup — a backup is a safety
/// net, not a gate.
pub async fn backup_if_pending(
    pool: &SqlitePool,
    db_path: &str,
    embedded_max_version: i64,
) {
    if !migration_pending(pool, embedded_max_version).await {
        return;
    }
    if let Err(e) = write_backup(db_path) {
        log::warn!("pre-migration backup failed (continuing): {e}");
    }
}

/// True when the DB's highest applied migration is below the embedded max.
/// A missing `_sqlx_migrations` table means a legacy/imported DB with data
/// but no migration history → treat as pending so it gets snapshotted.
async fn migration_pending(pool: &SqlitePool, embedded_max_version: i64) -> bool {
    let applied: Option<i64> =
        match sqlx::query("SELECT MAX(version) AS v FROM _sqlx_migrations")
            .fetch_optional(pool)
            .await
        {
            Ok(Some(row)) => row.try_get::<Option<i64>, _>("v").ok().flatten(),
            Ok(None) => None,
            Err(_) => return true, // table absent → legacy DB with data
        };
    match applied {
        Some(v) => v < embedded_max_version,
        None => false, // migrations table exists but empty → fresh DB
    }
}

fn write_backup(db_path: &str) -> std::io::Result<()> {
    let src = Path::new(db_path);
    if !src.exists() {
        return Ok(()); // fresh DB, nothing to back up
    }
    let dir = backups_dir(src);
    fs::create_dir_all(&dir)?;
    let stamp = backup_stamp(src);
    let dest = dir.join(format!("meeting_minutes-{stamp}.sqlite"));
    fs::copy(src, &dest)?;
    log::info!("pre-migration backup written: {}", dest.display());
    prune(&dir);
    Ok(())
}

fn backups_dir(src: &Path) -> PathBuf {
    src.parent().unwrap_or_else(|| Path::new(".")).join("backups")
}

/// Monotonic-ish stamp from file mtime (seconds); avoids a clock dependency
/// and keeps names sortable for pruning.
fn backup_stamp(src: &Path) -> u64 {
    src.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Keep the newest `MAX_BACKUPS` backups (lexical sort == chronological here).
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut backups: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("meeting_minutes-") && n.ends_with(".sqlite"))
        })
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(MAX_BACKUPS);
    for old in backups.into_iter().take(excess) {
        let _ = fs::remove_file(old);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_backup_noop_on_missing_source() {
        let dir = std::env::temp_dir().join("miting_bkp_missing");
        let _ = fs::remove_dir_all(&dir);
        let missing = dir.join("nope.sqlite");
        write_backup(missing.to_str().unwrap()).unwrap();
        assert!(!dir.join("backups").exists());
    }

    #[test]
    fn write_backup_copies_and_prunes() {
        let dir = std::env::temp_dir().join("miting_bkp_prune");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("meeting_minutes.sqlite");
        // Seed >MAX_BACKUPS existing backups plus the live DB.
        let bdir = dir.join("backups");
        fs::create_dir_all(&bdir).unwrap();
        for i in 0..(MAX_BACKUPS + 3) {
            fs::write(bdir.join(format!("meeting_minutes-{i:03}.sqlite")), b"old").unwrap();
        }
        fs::write(&db, b"live-data").unwrap();
        write_backup(db.to_str().unwrap()).unwrap();
        let count = fs::read_dir(&bdir).unwrap().count();
        assert!(count <= MAX_BACKUPS, "prune kept {count} > {MAX_BACKUPS}");
    }
}
