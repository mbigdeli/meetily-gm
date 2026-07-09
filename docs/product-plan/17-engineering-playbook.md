# 17 — Engineering Playbook (how we build Miting)

> The operating rules for turning docs 01–15 into shipped code with minimal
> defects and cheap rollback. Short by design; the detail lives in the
> `.claude/skills/` playbooks, which are canonical.

---

## Principle

We can't promise "zero defects" — nobody can. We **minimize defect probability**
(automated gates on every change) and make **every defect cheaply reversible**
(a layered rollback map). Small changes, always green, always revertible.

## The gates (M0 — now in place)

- **CI** (`.github/workflows/ci.yml`, runs on every PR + push to `main`):
  - Rust (windows): `cargo fmt --check`, `cargo clippy --lib -- -D warnings`, `cargo test --lib`
  - Extension (ubuntu, npm): `typecheck` + `vitest`
  - Frontend (ubuntu, pnpm): `typecheck` + `next lint`
  - Conventions: file-length gate + commitlint (PRs)
- **`main` is protected**: PR + green CI required; **squash-merge only** (manual GitHub setting — human checkpoint).

## Conventions (enforced)

- **Conventional Commits v1.0.0**, one commit per increment, each compiling with
  tests green. `commitlint.config.mjs` + CI. (See `release-rollback` skill.)
- **New/refactored source files ≤120 lines** (code lines; Rust inline
  `#[cfg(test)]` and separate test files excluded). Enforced by
  `scripts/check-file-length.mjs` on changed files. Honest note: this is
  stricter than the mainstream norm (ESLint `max-lines` default 300) — chosen
  deliberately for reviewability. Pre-existing large files are **grandfathered**
  in that script and split on next touch, never grown.
- **Tests + e2e with every feature** — see the `testing-e2e` skill for which of
  the four layers a given test belongs in. Per-PR suite <5 min; desktop
  WebDriver smoke gates the beta release, not each PR.

## Skills (load before working)

`.claude/skills/`: `rust-skills`, `tauri-dev`, `extension-dev`, `testing-e2e`,
`db-migrations`, `release-rollback`. Cursor loads the same via
`.cursor/rules/00-skills.mdc`.

## Rollback map

| Broke | Undo |
|---|---|
| Code on `main` | `git revert <sha>` → PR |
| Shipped UI feature | flip its BetaFeatures flag off |
| Schema migration | reinstall prior version + restore `backups/*.sqlite` (db-migrations runbook) |
| Bad fleet release | `node scripts/rollback-release.mjs --to <prev-tag>` |
| Extension | re-unpack previous `dist`; host kill switch |
| Integration | disconnect wipes keychain tokens; deliveries logged |

DB safety is live now: `database::backup::backup_if_pending` snapshots the
SQLite file before any pending forward-only migration (keeps last 5).

## Milestone order (features; doc 16 AI-strategy excluded for now)

M0 safety net (this doc) → **M1** Claude Code provider (14) → **M2** rebrand +
own analytics + own updater (01, 02) → **M3** redesign foundation (13) → **M4**
meetings page (09) → **M5** Prompt Studio (06) → **M6** extension self-install +
pairing (15) → **M7** Persian (03) → **M8** participants export (04) → **M9**
diarization hardening (05) → **M10** connector platform (10) → **M11** Slack
(08) → **M12** Jira (07).

**Definition of Done per milestone** = that doc's acceptance-criteria checklist
+ CI green + (for flagged features) a beta soak with the flag default-off.
Finish each with a short handoff note under `docs/reports/`.
