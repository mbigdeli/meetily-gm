# 02 — Own Analytics & Own Update Channel

> Phase 0 · Effort: 1–2 days · Covers user requests #9 (updates) and #10 (analytics)

---

## Implementation status (M2, partial — safe slice done)

**Shipped:**
- Upstream PostHog key removed from `analytics/commands.rs`; the key is now read
  at build time from `MITING_POSTHOG_KEY` (`option_env!`), and analytics is
  `enabled` only when a key is present. With no key, `AnalyticsClient::new`
  creates no client (`analytics.rs:87`) → **zero telemetry egress**. No data can
  reach Meetily's workspace.
- Deleted dead `lib_old_complex.rs` (held a second stale key). No hardcoded
  `phc_` keys remain in `src/`.
- Updater endpoint (`tauri.conf.json`) and `generate-update-manifest-github.js`
  repointed from `Zackriya-Solutions/meeting-minutes` → `mbigdeli/meetily-gm`
  (GitHub redirects this if the repo is later renamed to `miting`).

**Still to do (needs a decision / a manual step):**
- **Signing key:** the updater `pubkey` is still upstream's minisign key. Until
  a new keypair is generated (`pnpm tauri signer generate`) and releases are
  signed with it, no OTA update will verify/install — a safe failsafe, but
  auto-update is effectively off until then. This is a human step (§4.1).
- **Identifier / productName rename** (`com.meetily.ai` → `li.bigde.miting`,
  `meetily` → `Miting`): deferred — it moves the app-data directory, so it needs
  the one-time data-migration decision in doc 01 §4 before flipping.
- Own PostHog project + `MITING_POSTHOG_KEY` in CI secrets (when the owner wants
  telemetry back on).

## 1. Goal

1. **Analytics:** no event ever reaches Meetily's PostHog workspace. Replace with the author's own PostHog project, preserving the existing opt-in consent UX.
2. **Updates:** the app checks the author's GitHub releases — never Zackriya's — with a fresh signing keypair.

---

## 2. Current state (verified)

| Item | File | Problem |
|---|---|---|
| Hardcoded upstream PostHog key `phc_Aa9PqeCkDkVbtbRsYjtmHANBfcscjCVupxZwrtL5vZ77` | `frontend/src-tauri/src/analytics/commands.rs:12` | All telemetry flows to Meetily's workspace |
| Endpoint `https://us.i.posthog.com` | same file | Fine to keep (PostHog US cloud) once key is ours |
| Analytics core (identify, sessions, events, sanitization of sensitive keys) | `frontend/src-tauri/src/analytics/analytics.rs` (posthog-rs 0.3.7) | Keep — well built |
| Frontend wrapper (DAU, first-launch, feature usage; local `analytics.json` store) | `frontend/src/lib/analytics.ts` (837 lines) | Keep |
| Consent UI (toggle, user-id display, 2-step disable, privacy link) | `frontend/src/components/AnalyticsConsentSwitch.tsx`, `AnalyticsDataModal.tsx` | Keep; swap privacy URL |
| Dead file w/ second old key `phc_cohhHPgf…` | `frontend/src-tauri/src/lib_old_complex.rs` | Delete |
| Updater endpoint → Zackriya releases + their minisign pubkey | `frontend/src-tauri/tauri.conf.json:114–119` | Replace both |
| Update client (24 h throttle, no hardcoded URLs) | `frontend/src/services/updateService.ts`, `UpdateDialog.tsx` | Keep unchanged |
| Release manifest scripts | `scripts/generate-update-manifest-github.js`, `scripts/test-update-locally.js` | Point at own repo |

---

## 3. Analytics plan

### 3.1 Setup

1. Create a **new PostHog project** dedicated to Miting (separate from any work/DrBalcony projects — personal OSS telemetry should not mix with employer data). US cloud, free tier (1M events/mo — far beyond expected volume).
2. Swap the key in `analytics/commands.rs:12`; key stays compile-time embedded (public write-only project keys are designed to ship in clients — this is normal for PostHog).
3. Delete `lib_old_complex.rs`.

### 3.2 Event taxonomy (keep existing, it's sound)

Retained events: `app_launched`, `first_launch`, session start/end, `meeting_recorded` (duration bucket only), `summary_generated` (provider, model, success/fail, latency bucket), `feature_used` (feature name), settings-changed (key only). **Sanitizer already strips** meeting titles, device names, file paths — keep the deny-list, extend it with `participant`, `speaker`, `prompt` prefixes as new features land.

New events to add as features ship: `integration_connected` (kind), `task_pushed` (kind, count bucket), `prompt_style_created`, `export_used` (format), `language_set` (fa/en).

**Never collected:** transcript text, summaries, prompts, participant names, meeting titles, Jira/Slack content, tokens.

### 3.3 Consent (unchanged behavior)

- First launch: consent screen, analytics OFF until accepted (existing flow).
- Settings → General keeps `AnalyticsConsentSwitch` with the what-we-collect modal.
- Privacy link → `https://miting.bigde.li/privacy`.

### 3.4 PRIVACY_POLICY.md rewrite (outline)

1. Summary: local-first, no meeting content leaves the device, telemetry opt-in.
2. What we collect when analytics is ON (table from §3.2), what we never collect.
3. Where it goes (own PostHog project, US), retention.
4. Third-party services *the user chooses to connect* (Ollama local; OpenAI/Anthropic/… under their own keys; Jira/Slack under their own accounts) — Miting is a client, not a processor.
5. Update checks: what a GitHub release check exposes (IP to GitHub, version string).
6. Contact: mohamad@bigde.li (or preferred address).

---

## 4. Update channel plan

### 4.1 New signing key

```bash
pnpm tauri signer generate -w ~/.tauri/miting.key   # generates keypair
```
- Private key: local + GitHub Actions secret (`TAURI_SIGNING_PRIVATE_KEY`, password in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). **Never committed.**
- Public key replaces `updater.pubkey` in `tauri.conf.json`.
- Old Zackriya pubkey removed — their updates could otherwise be installed if endpoint were ever misconfigured.

### 4.2 Endpoint

```json
"updater": {
  "pubkey": "<NEW_MITING_PUBKEY>",
  "endpoints": [
    "https://github.com/mbigdeli/miting/releases/latest/download/latest.json"
  ]
}
```

### 4.3 Release workflow

- `.github/workflows/release.yml`: on tag `v*` → build Windows (+ macOS/Linux when ready) → sign → attach installers + `latest.json` to the GitHub release.
- `scripts/generate-update-manifest-github.js`: repo slug → `mbigdeli/miting`; strip Zackriya references.
- Version source of truth: `tauri.conf.json` `version`; `About.tsx` reads `getVersion()` (kills the hardcoded 0.4.0).
- First Miting release: bump minor (e.g. `0.5.0`) so rebranded builds are strictly newer than any installed meetily-gm build.

### 4.4 UX

Existing `updateService` (24 h throttle) + `UpdateDialog` unchanged. About page button (doc 01 §5) triggers manual check. Add a "release notes" link in the dialog → GitHub release page.

---

## 5. Edge cases

- **Installed old builds** (identifier change, doc 01 §4): old meetily-gm builds point at Zackriya endpoint and will never see Miting releases → release notes + landing page instruct a one-time manual reinstall.
- **Updater offline/GitHub rate-limited:** existing silent-fail behavior is correct; manual check surfaces the error string.
- **PostHog outage/blocked:** posthog-rs must never block the UI; verify events are fire-and-forget (they are — async task).

## 6. Acceptance criteria

- [ ] Fresh install, consent declined → zero outbound requests to `*.posthog.com` (verify with proxy).
- [ ] Consent accepted → events appear in own PostHog project; none in any other workspace (old key fully gone from source + build artifacts: `grep -r phc_ src-tauri/`).
- [ ] `latest.json` fetched from own repo; a staged `v0.5.1` test release is detected and installs (use `scripts/test-update-locally.js` first).
- [ ] Update signed with new key verifies; artifact tampered → install refused.
- [ ] PRIVACY_POLICY.md rewritten; consent modal links resolve.
