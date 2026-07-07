# 03 — Persian (فارسی) Language Support

> Phase 1 · Effort: ~1 week · Covers user request #2 · Flagship differentiator (no mainstream meeting tool does Farsi well)

---

## 1. Goal

A Persian-speaking PM can record a Farsi (or mixed Farsi/English) meeting and get: an accurate Farsi transcript rendered RTL, correctly diarized speaker names (Persian names already handled by the extension), and a Farsi summary — with zero configuration beyond picking the language once.

**Scope levels:**
- **L1 (this doc, Phase 1):** content-level Persian — transcription, transcript/summary rendering, prompts/output in Farsi.
- **L2 (later, backlog):** full UI localization (menus/settings in Farsi) via an i18n framework.

---

## 2. Current state (verified)

| Piece | Status | File |
|---|---|---|
| Extension caption language enum `fa \| en` | ✅ exists | `extension/src/shared/schemas.ts:4–7` |
| Extension sends `source_language_setting` per session | ✅ exists | `extension/src/content/capture/coordinator.ts:390` |
| Persian-name detection in participants roster (`/[؀-ۿ]/`) | ✅ exists | `extension/src/content/capture/participants.ts` |
| RTL direction helper `textDirection()` | ✅ exists (extension options UI only) | `extension/src/options/recordings/helpers.ts:80–88` |
| Global `LANGUAGE_PREFERENCE` (default `"auto-translate"`) | 🟡 exists, plumbing unclear | `frontend/src-tauri/src/lib.rs:70–72` |
| Explicit Whisper `language` param wired end-to-end | ❌ not found | `whisper_engine/whisper_engine.rs` |
| Desktop transcript/summary RTL rendering | ❌ missing | `frontend/src/app/_components/TranscriptPanel.tsx`, `AISummary/` |
| Summary output language setting | ✅ exists (General settings) | `PreferenceSettings.tsx` → prompt directive in `summary/processor.rs` |
| Diarization prompt language field | ✅ segments carry `language` | `gmeet_ingest/diarize.rs` (`DiarizedSegment.language`) |
| Desktop UI i18n framework | ❌ none | — |

**Key insight:** most primitives exist; the work is *plumbing + rendering*, not invention.

---

## 3. Design

### 3.1 One language setting, three consumers

Settings → General gains a **Meeting language** select: `Auto-detect · English · فارسی (Persian)` (extensible enum, not fa/en-only switch).

Consumers:
1. **Whisper engine** — pass ISO code (`fa`, `en`, or auto) into whisper-rs full-params (`set_language`). "auto-translate" legacy value maps to auto. Stored in `transcript_settings` table (new column or reuse existing settings row).
2. **Summary prompt** — existing language directive in `processor.rs::generate_meeting_summary()` gets the same value; when `fa`, the directive becomes an explicit Persian-output instruction *written in Persian* (LLMs comply better): `خلاصه را کاملاً به زبان فارسی بنویس…`
3. **Extension session** — desktop pushes the preference so `source_language_setting` matches (extension override per-meeting stays possible; per-session value wins over global).

Per-meeting override: recording start flow exposes the same select (defaulted from global), stored on the meeting row (`meetings.language TEXT NULL` migration) so re-transcription/re-summarization reuse it.

### 3.2 RTL rendering (desktop app)

- Port/centralize `textDirection()` into `frontend/src/lib/text.ts` (shared util; extension keeps its copy or imports from a shared package later).
- **TranscriptPanel:** per-segment `dir={textDirection(seg.text)}` + `text-align` start; segment metadata (speaker chip, timestamp) stays LTR-positioned but flips alignment in RTL segments. Mixed-language meetings therefore render correctly line-by-line (`dir="auto"` semantics).
- **AISummary / BlockNote view:** summary container `dir="auto"`; for `fa` output set `dir="rtl"` on the rendered markdown container. Lists/tables must flip (Tailwind: use logical properties `ps-*/pe-*` instead of `pl-*/pr-*` in these components — audit the two components only, not the whole app; the full logical-property sweep belongs to the redesign, doc 13 §5).
- **Font:** bundle **Vazirmatn** (OFL license, the de-facto Persian UI font) locally (no CDN — offline app). Font stack: `Vazirmatn, <existing sans>, sans-serif` applied when content is RTL. Digits: keep Latin digits for timestamps/durations (product decision — consistency with UI).

### 3.3 Whisper guidance for Farsi

| Model | Farsi quality | Recommendation |
|---|---|---|
| tiny/base/small | Poor–unusable | Hide behind "not recommended for فارسی" hint |
| medium | Acceptable | Minimum suggested |
| large-v3 | Good | **Recommended**; suggest on first fa selection if not installed (existing model-download flow) |

When user selects Persian and active model < medium → non-blocking warning toast with one-click "Download large-v3".

Parakeet: English-only — selecting Persian while Parakeet engine is active must fall back to Whisper with an explanatory notice.

### 3.4 Persian prompt templates

Prompt Studio (doc 06) ships two seeded Persian styles: `جلسه استاندارد` (standard meeting) and `جلسه روزانه` (standup), bodies written in Persian. Cheap to produce, huge signal for the Persian community launch (doc 12 §5).

### 3.5 L2 preview (out of scope now)

If/when UI localization happens: `next-intl` (App-Router-friendly), `<html dir>` switching, message catalogs `en.json`/`fa.json`. Deliberately deferred — content-language support delivers 90 % of user value at 20 % of the cost.

---

## 4. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` | Accept explicit language; map `auto`; set whisper-rs `set_language(Some("fa"))` |
| `frontend/src-tauri/src/lib.rs:70–72` | Replace ad-hoc `LANGUAGE_PREFERENCE` global with setting read (single source of truth) |
| `frontend/src-tauri/migrations/…_meeting_language.sql` | `ALTER TABLE meetings ADD COLUMN language TEXT` |
| `frontend/src-tauri/src/summary/processor.rs` | Persian-written output directive when fa |
| `frontend/src/components/PreferenceSettings.tsx` | Meeting-language select |
| Recording start UI (`frontend/src/app/page.tsx`) | Per-meeting language override |
| `frontend/src/lib/text.ts` (new) | `textDirection()` shared util |
| `frontend/src/app/_components/TranscriptPanel.tsx` | per-segment dir + logical-property alignment |
| `frontend/src/components/AISummary/*` | container dir, RTL-safe list/table styles |
| `frontend/src/app/layout.tsx` + local font file | Vazirmatn @font-face |
| `extension/src/content/capture/coordinator.ts` | accept pushed default language from desktop settings |

## 5. Edge cases

- **Mixed-language meeting:** Whisper pinned to `fa` transcribes English speech as garbage → default remains **Auto** unless user explicitly pins; document trade-off in the setting's helper text (pin = better fa accuracy, auto = safer for mixed).
- **RTL + timestamps:** bidi can reorder `12:03 علی` — wrap timestamps in `<bdi>`/`dir="ltr"` spans.
- **Diarization prompt:** already language-aware per segment; verify Codex merge prompt doesn't force English output for fa text (it shouldn't — it copies text verbatim).
- **Search:** SQLite `LIKE` is fine for Persian (no case folding needed); verify no `LOWER()` assumptions corrupt matching.

## 6. Acceptance criteria

- [ ] Record a Farsi test clip → transcript in Persian script, rendered RTL, correct per-segment direction in a mixed clip.
- [ ] Summary generated fully in Persian when language=fa, RTL-rendered, lists aligned right.
- [ ] Language pin survives restart; per-meeting override respected on re-run pipeline.
- [ ] Parakeet+fa → graceful fallback message.
- [ ] Model warning appears for small models + fa.
- [ ] Vazirmatn renders offline (no network font fetch).
