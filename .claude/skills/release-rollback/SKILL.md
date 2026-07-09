---
name: release-rollback
description: >
  Miting's branch/PR/commit discipline, feature-flag graduation, release
  channels, and the layered rollback map (git revert → flag → DB restore →
  OTA republish). Use when committing, opening PRs, cutting releases, or
  reverting a bad change. Invoke with /release-rollback.
metadata:
  version: "1.0.0"
  sources:
    - https://www.conventionalcommits.org/en/v1.0.0/
    - docs/product-plan/17-engineering-playbook.md
---

# Release & rollback (Miting)

## Commits — Conventional Commits v1.0.0 (enforced by commitlint in CI)

- `type(scope): subject` — types: `feat fix refactor perf test docs ci build chore revert`; `!` or `BREAKING CHANGE:` for breaking.
- **One commit per increment**, each compiling with tests green (history stays
  bisectable). Subject ≤100 chars.
- End messages with the repo's co-author trailer when applicable.

## File size

New/refactored source files stay **≤120 lines** (excl. tests/generated),
enforced by `scripts/check-file-length.mjs` on changed files. This is stricter
than the norm (ESLint `max-lines` default 300) — deliberate. Pre-existing large
files are grandfathered in that script; **split them the next time you touch
them**, don't grow them.

## Branches / PRs

- Branch per milestone: `feat/09-meetings-page`, `feat/14-claude-code`, …
- `main` is protected: PR + green CI required. **Squash-merge only** → each
  feature is one commit on `main` → clean `git revert <sha>`.
- Tag releases `v*` (SemVer). Beta = GitHub **pre-release**; stable after soak.

## Feature flags (graduation)

Reuse `frontend/src/types/betaFeatures.ts` (localStorage, defaults-merge).
Lifecycle: ship **default-off** → dogfood ≥1 week on real meetings → default-on
→ remove the flag next release. Rust-side risky paths get a settings-table kill
switch read at startup. Planned flags: `newAppShell`, `meetingsPage`,
`promptStudio`, `integrations`.

## Rollback map (fastest reversible layer first)

| Broke | Undo |
|---|---|
| Code on main | `git revert <sha>` → PR → auto-release |
| A shipped UI feature | flip its BetaFeatures flag off (patch release); users can toggle instantly |
| A schema migration | reinstall prior app version + restore `backups/*.sqlite` (see **db-migrations** runbook) |
| A bad release (fleet) | `node scripts/rollback-release.mjs --to <prev-tag>` → republishes prior `latest.json`; clients downgrade next check |
| Extension | re-unpack previous `dist`; host-side kill switch reverts to manual pairing |
| Integration | Disconnect wipes keychain tokens; external side-effects are in the delivery log for manual cleanup |

## Releasing

1. Merge milestone PR (squash, conventional title).
2. Tag `vX.Y.Z`; the manual `release.yml` builds + signs + attaches installers +
   `latest.json`. Cut as **pre-release** first.
3. Soak on the beta channel (desktop smoke suite must be green).
4. Promote to stable. Keep every release's assets forever (rollback depends on
   immutable prior `latest.json`).

## Prerequisite (M2)

OTA rollback only works once the updater endpoint + `generate-update-manifest`
point at **our** repo, not upstream Zackriya (doc 02). Until then, rollback is
git-revert + flag + local DB restore only.
