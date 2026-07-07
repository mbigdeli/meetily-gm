# 01 — Rebrand & Identity: Meetily-GM → Miting

> Phase 0 · Effort: 2–3 days (excl. icon design) · Blocks: public repo, all other docs' URLs

---

## 1. Name decision record

**Chosen name: Miting** (user decision, final).

- Pronunciation: "MEE-ting" — intentionally the word *meeting*, minus one letter.
- Also reads naturally to Persian speakers (میتینگ is the loanword for a public meeting/rally).
- Legal check (2026-07): no software product uses "Miting". `github.com/miting` is an inactive squatted user account; `miting.biz` is an unrelated IT community; the word means "meeting/rally" in Tagalog/Indonesian/Turkish.

**Evaluated and rejected:** Meething (existing Mozilla-backed WebRTC project), MinuteMate/Meetwise/Briefly/Recapio/Meetsum (all occupied in this exact space), Neshast/Bardasht/Chekide/Nokte/Daqiq (clean Persian options — kept on record here in case of future pivot).

**Known trade-off (accepted):** search engines and humans autocorrect "miting" → "meeting". Mitigations:
- Always pair the name with the tagline: **"Miting — AI meeting minutes"** (title tags, README H1, App name in stores/listings).
- Own the brand query surface: `miting.bigde.li` is the canonical URL; consider registering `getmiting.com` later.
- Never publish the bare word "Miting" as a page title without the tagline.
- Lean into it in copy: *"Miting. Like meeting, minus the noise."*

### Brand strings (canonical, use everywhere)

| Key | Value |
|---|---|
| Product name | `Miting` |
| Tagline | `AI meeting minutes — local, private, free` |
| Bundle identifier | `li.bigde.miting` (reverse of bigde.li; fallback `com.miting.app`) |
| Window title | `Miting` |
| GitHub org/repo | `github.com/mbigdeli/miting` (or org `miting-app` if moved to an org later) |
| Website | `https://miting.bigde.li` |
| Author line | `Built by Mohamad Bigdeli` |
| Extension name | `Miting Companion for Google Meet` |

> ⚠️ Changing the Tauri `identifier` changes `%APPDATA%` paths (`%APPDATA%\Meetily` → new dir). See §4 data-migration note.

---

## 2. Rename inventory (exact files)

### 2.1 App identifiers — CRITICAL

| File | Line(s) | Change |
|---|---|---|
| `frontend/src-tauri/tauri.conf.json` | 3, 15 | `"productName": "meetily"` → `"Miting"` (2×) |
| `frontend/src-tauri/tauri.conf.json` | 5 | `"identifier": "com.meetily.ai"` → `"li.bigde.miting"` |
| `frontend/src-tauri/tauri.conf.json` | 95 | window `"title": "meetily"` → `"Miting"` |
| `frontend/src-tauri/Cargo.toml` | 2, 4, 7 | `name = "miting"`, new description, `repository = "https://github.com/mbigdeli/miting"` |
| `frontend/package.json` | 2 | `"name": "miting"` |
| `frontend/src-tauri/Cargo.lock` | — | regenerates on build; no manual edit |

### 2.2 UI strings & links — HIGH

| File | What | Change |
|---|---|---|
| `frontend/src/components/About.tsx` | "Chat with the Zackriya team" (L66), "Built by Zackriya Solutions" (L143), "What makes Meetily different" (L98), `https://meetily.zackriya.com/#about` (L26), hardcoded version | Full rewrite — see §5 About page spec |
| `frontend/src/components/AnalyticsConsentSwitch.tsx` | L150 privacy-policy URL → Zackriya repo | → `https://miting.bigde.li/privacy` (host PRIVACY_POLICY.md content there; also keep the file in repo) |
| `frontend/src/components/onboarding/steps/SetupOverviewStep.tsx` | L49 "Meetily requires…", L101 GitHub link | Rename + own repo URL |
| `frontend/src/components/BluetoothPlaybackWarning.tsx` | L84 `github.com/your-org/meetily/...` placeholder | Own repo URL |
| `frontend/src/app/metadata.tsx`, `metadata.ts` | app title/description | `Miting — AI meeting minutes` |
| `extension/src/options/sections/MeetilyConnectionSection.tsx` | component name + strings | Rename to `MitingConnectionSection` (mechanical) |
| `extension/manifest.json` | L3 `"Meeting Capture System"` | `"Miting Companion for Google Meet"` |

### 2.3 Docs & legal — HIGH/MEDIUM

| File | Change |
|---|---|
| `README.md` | Full rewrite (outline in doc 12 §2). Remove Trendshift badge, Zackriya release links, `meetily.ai`, Discord `discord.gg/crRymMQBFH`, `zackriya.com/meetily-subscribe`. Keep a **fork acknowledgment section** (see §6). |
| `CONTRIBUTING.md` | Repo URLs → own; keep MIT notes |
| `LICENSE.md` | Already dual-attributed: `Copyright (c) 2024 Zackriya Solutions (Meetily)` + `Copyright (c) 2026 Mohamad Bigdeli`. Update the fork line to "(Miting, a fork of Meetily)". **Do not remove the upstream copyright line — MIT requires it.** |
| `PRIVACY_POLICY.md` | Rewrite for Miting: own PostHog project, opt-in, data list (doc 02 §3); published at miting.bigde.li/privacy |
| `docs/architecture.md`, `docs/BUILDING.md`, `docs/GPU_ACCELERATION.md` | Search/replace product name; verify no zackriya URLs |
| `CLAUDE.md` | Update product name + repo pointers |

### 2.4 Assets — HIGH

| Asset | Location | Action |
|---|---|---|
| App icons | `frontend/src-tauri/icons/` (`icon.png/.ico/.icns`, `128x128*`, `Square*`, `StoreLogo.png`) | New Miting icon set — single source SVG → `pnpm tauri icon` regenerates all sizes |
| Extension icons | `extension/` dist (`icon16/32/48/128.png`) | Same source mark, badge variant |
| README hero images | `docs/Meetily-6.png`, `demo_small.gif`, `meetily_demo.gif` | Re-capture after redesign (Phase 1) — placeholder text until then |
| Old logos | `docs/logo1-3.png` | Replace |

**Icon direction (for designer/AI-gen):** a speech-bubble/soundwave mark that reads at 16 px; works on dark & light; wordmark set in a geometric sans (matches redesign tokens, doc 13 §3). Persian-friendly: avoid Latin-letterform-only marks.

### 2.5 External URLs — classification

| URL | Verdict |
|---|---|
| `https://github.com/Zackriya-Solutions/meeting-minutes/releases/.../latest.json` (updater) | **REPLACE** — doc 02 §5 |
| `https://us.i.posthog.com` + key `phc_Aa9Pqe…` | **REPLACE key**, endpoint stays PostHog US cloud (own project) — doc 02 |
| `https://meetily.zackriya.com`, `meetily.ai`, Discord, LinkedIn | **REMOVE** |
| `https://meetily.towardsgeneralintelligence.com/models/...` (Parakeet mirror, `parakeet_engine.rs:598`) | **VERIFY** — if it's upstream's mirror, either (a) point at the original NVIDIA/HF source, or (b) mirror under own GitHub release assets. Do not ship a dependency on an upstream-controlled URL. |
| HuggingFace whisper.cpp model URLs (`whisper_engine.rs:935–950`) | **KEEP** (canonical model source — user approved) |
| OpenAI/Anthropic/Groq/OpenRouter/Ollama API endpoints | **KEEP** (user-configured providers) |
| `frontend/src-tauri/src/lib_old_complex.rs` (dead code, contains 2nd old PostHog key) | **DELETE** |

---

## 3. GitHub migration steps

1. Rename repo `meetily-gm` → `miting` (GitHub auto-redirects old clones).
2. Repo description: "Miting — free, local-first AI meeting minutes for PMs. Whisper transcription, speaker diarization, Codex/Ollama summaries, Jira & Slack push. فارسی supported."
3. Topics: `meeting-notes`, `whisper`, `tauri`, `ai`, `local-first`, `jira`, `slack`, `persian`, `farsi`, `product-management`.
4. Update `.github/workflows/*.yml`: release workflow must publish `latest.json` + signed artifacts to *this* repo's releases (doc 02 §5); check for hardcoded Zackriya refs in `build*.yml`, `release.yml`.
5. Enable: Issues, Discussions (Q&A + Show-and-tell), branch protection on `main`.
6. Social preview image (1280×640) with logo + tagline.

---

## 4. Data migration note (identifier change)

Changing `identifier` moves app data (`%APPDATA%\Meetily\` → `%APPDATA%\li.bigde.miting\` or per Tauri path resolution). Existing users (currently: the author + early testers) would lose meetings/models unless migrated.

**Spec:** on first launch, if new data dir is empty and legacy `Meetily` dir exists → offer one-time copy migration (SQLite DB, `models/`, `templates/`). Implementation detail belongs to Phase 0; ~½ day. Alternative (acceptable given user base ≈ author): document manual folder copy in release notes and skip the code.

---

## 5. About page spec (feature request #9)

Replaces `About.tsx`. Content:

- **Miting logo + version** (read version from `getVersion()` — remove the hardcoded `0.4.0`).
- **"Check for updates"** button (existing `updateService.checkForUpdates()`, now hitting own endpoint — doc 02 §5).
- **Author block:** photo/avatar, "Built by **Mohamad Bigdeli** — product manager building tools for people with too many meetings." Links: `miting.bigde.li`, GitHub repo, LinkedIn.
- **Acknowledgment line:** "Based on the open-source [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes) project by Zackriya Solutions." (small, factual — honest and license-friendly).
- **Privacy line:** "Your meetings never leave this device unless you send them somewhere." → link to privacy page.
- No Discord/community links until they exist (Discussions link instead).

---

## 6. License & attribution obligations

- Upstream is **MIT**: redistribution requires preserving the copyright notice. `LICENSE.md` keeps both lines (already the case). ✔
- README keeps a short **"Credits"** section acknowledging Meetily as the base project with a link — not legally required beyond LICENSE, but correct open-source citizenship and avoids community backlash that would damage the personal-branding goal.
- Fork stays a *hard fork* (own name, own release chain, no upstream update checks). Cherry-pick policy in doc 12 §6.

---

## 7. Verification checklist

```powershell
# 1. No stray branding (expect hits ONLY in LICENSE.md, README credits, this docs folder)
git grep -i -E "meetily|zackriya" -- ':!docs/product-plan'

# 2. Build artifacts named correctly
pnpm run tauri:build   # installer named Miting_*.exe, product metadata correct

# 3. App smoke test
#    - window title "Miting"; About shows new content + working update check
#    - %APPDATA% dir is the new identifier path
#    - extension options page shows "Miting Companion"

# 4. No network calls to zackriya/meetily domains (Fiddler/devtools while using the app)
```
