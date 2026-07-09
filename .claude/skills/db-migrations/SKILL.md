---
name: db-migrations
description: >
  Rules for changing the Miting SQLite schema safely — additive-only,
  forward-only sqlx migrations, the pre-migration backup, repository tests,
  and the restore runbook. Use whenever adding a migration, a column, a table,
  or a repository. Invoke with /db-migrations.
metadata:
  version: "1.0.0"
  sources:
    - https://docs.rs/sqlx/latest/sqlx/macro.migrate.html
    - frontend/src-tauri/src/database/
---

# DB migrations (Miting)

DB: `meeting_minutes.sqlite` in the Tauri `app_data_dir()`. Migrations are
embedded (`sqlx::migrate!("./migrations")`) and run at startup in
`database/manager.rs` — **forward-only, no down-scripts.**

## The rules

1. **Additive-only.** New tables / new nullable (or defaulted) columns / new
   indexes. **No `DROP`/`RENAME`** in the same release that stops using
   something. Destructive cleanup waits ≥2 stable releases behind a separate
   migration.
2. **One concern per migration**, monotonic timestamp filename
   (`YYYYMMDDhhmmss_short_name.sql`), matching the existing 12.
3. **Never edit an applied migration.** sqlx checksums them; a changed file
   fails to boot. Fix-forward with a new migration.
4. **Rollback = a new forward migration**, never a down-script. For data-loss
   cases, rely on the pre-migration backup (below) + reinstalling the prior app
   version.
5. SQLite pragmas already handled by the pool; keep WAL + a busy_timeout in
   mind for long writes.

## Pre-migration backup (already wired)

`database::backup::backup_if_pending` runs in `manager.rs` **before**
`migrator.run()`. It copies the existing DB to `app_data_dir/backups/` only when
the embedded migrator is ahead of the DB's applied version, keeping the last 5.
Backup failure logs and continues (safety net, not a gate). Don't remove this
call when editing `manager.rs`.

## Restore runbook

1. Quit Miting.
2. In `app_data_dir` (`%APPDATA%\<bundle-id>\` on Windows), copy the chosen
   `backups/meeting_minutes-<stamp>.sqlite` over `meeting_minutes.sqlite`
   (delete `-wal`/`-shm` siblings first).
3. Reinstall the **app version that matches that backup's schema** (a newer app
   will just re-migrate the restored file — fine if additive).
4. Relaunch.

## Testing a migration (required with every schema change)

- Add repository tests against a **temp/in-memory SQLite** (the `database/`
  layer had 0 tests before M0 — grow it).
- Include a "migrate a fresh DB" test and a "migrate a fixture DB seeded at the
  previous release's schema" test, asserting no data loss and the new
  columns/tables exist. Put fixtures under `src-tauri/tests/fixtures/`.

## Planned additive migrations (docs 04/06/07/09/10)

`starred`+`duration_sec` (09), `meeting_templates`+`template_id` (06),
`meeting_participants` v2 columns (04), `meeting_task_suggestions` (07),
`integration_deliveries` (10). All additive — keep them so.
