---
name: tauri-dev
description: >
  Tauri 2.x + Rust patterns for the Miting desktop app — commands, state,
  typed errors, capabilities, sqlx-in-Tauri, and this repo's registration and
  detached-subprocess rules. Use when adding/editing Tauri commands, Rust
  services, DB access, or wiring frontend↔Rust. Invoke with /tauri-dev.
metadata:
  version: "1.0.0"
  sources:
    - https://v2.tauri.app/develop/calling-rust/
    - https://v2.tauri.app/security/capabilities/
    - https://v2.tauri.app/plugin/sql/
---

# Tauri 2 development (Miting)

Also load **rust-skills** for the 179 idiomatic-Rust rules. This file is the
Tauri- and repo-specific layer on top.

## Commands

- One `tauri::generate_handler![...]` in `lib.rs`; commands in submodules must be
  `pub` and registered as `module::command_name`.
- **Async commands run on a separate task** — use them for anything that can
  block (I/O, subprocess, DB). They cannot take borrowed params: take owned
  types (`String`, not `&str`) and `State<'_, T>`.
- **Never `unwrap()`/`expect()` in a command.** Return `Result<T, E>` where
  `E: serde::Serialize`. Prefer a `thiserror` enum with a custom `Serialize`
  impl so the frontend receives a typed, explicit error — not a stringly blob.
- Keep commands **thin**: parse/validate → call a service module → serialize.
  Logic lives in `summary/`, `audio/`, `gmeet_ingest/`, etc.; DB access lives in
  `database/repositories/`. This repo already follows this — keep it.

## State

- Register shared state at `setup()` time with `app.manage(x)`; read via
  `State<'_, T>` in commands or `app.state::<T>()` elsewhere (`Manager` trait).
- Interior mutability: `Arc<RwLock<T>>` for shared async state, `Arc<AtomicBool>`
  for flags (repo convention). Don't hold a lock across `.await` (see
  rust-skills `anti-lock-across-await`).

## Events (Rust → frontend)

`app.emit("event-name", payload)?` where payload is `Serialize + Clone`.
Frontend listens with `listen<T>('event-name', cb)`. Use events for progress
and streaming state; use command return values for request/response.

## Capabilities (security)

- JSON files in `src-tauri/capabilities/`, schema-validated, target window
  **labels**. Least privilege per window — grant only the permission strings a
  window needs (`core:window:allow-set-title`, `plugin:sql:allow-execute`, …).
- Capabilities constrain the webview, **not** your Rust code.

## sqlx + SQLite (this repo owns the data → raw sqlx, not the JS SQL plugin)

- `SqlitePool` created in `database/manager.rs`; migrations embedded via
  `sqlx::migrate!("./migrations")` and run at startup **after** a
  pre-migration backup (see `database::backup` and the **db-migrations** skill).
- Pass the pool as managed state / repository structs; keep queries in
  `database/repositories/`. Forward-only migrations — never edit an applied one.

## Hard-won repo rules (violating these caused real bugs)

- **Long-running work must be a detached subprocess or spawned task**, never
  done inside a short-lived handler. The Native Messaging host and CLI-style
  entry points are short-lived; see `runtime::spawn_*` patterns and the codex
  integration (`codex/mod.rs`).
- On Windows, only spawn `.exe`/`.cmd`/`.bat` — npm installs an extensionless
  POSIX shim that fails with OS error 193. See `codex/mod.rs` binary resolution;
  mirror it for any new CLI provider (e.g. `claude_code`).
- Tests must **never** invoke a real external CLI (a stray `logout` logs the dev
  out). Use the env-override + mutex-guard pattern (`MEETILY_CODEX_EXE` /
  `MITING_CLAUDE_EXE`).

## Lint / size

`cargo clippy --lib -- -D warnings` must pass. `clippy.toml` sets
`too-many-lines-threshold = 120` (per function). New `.rs` files stay ≤120 lines
(enforced by `scripts/check-file-length.mjs`) — split into submodules early.
