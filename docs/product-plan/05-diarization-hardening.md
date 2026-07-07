# 05 — Diarization Hardening

> Phase 1 · Effort: 3–4 days · Covers user request #4 (feature exists — this makes it robust & visible)

---

## 1. Current state (verified — this already works)

`frontend/src-tauri/src/gmeet_ingest/diarize.rs`:

- Inputs: Whisper segments (`transcripts`: text + audio_start/end) × Meet captions (`gmeet_captions`: speaker, text, ts_ms) × participant roster hint.
- Merge: LLM call via `crate::codex::generate_with_codex` with `DIARIZE_SYSTEM_PROMPT` (66 lines) — aligns timelines by overlap + text similarity (handles constant offset between audio start and Meet start), caps 600 segments/600 caption events.
- Output: `meeting_diarized_segments (seq, start_sec, end_sec, speaker_name, language, confidence, text)` written atomically (delete+insert in one transaction).
- Retries ×3 with lenient JSON parsing (`parse_json_lenient` strips md fences); fallback → Whisper text with speaker "Unknown" (no data loss). Captions-only and Whisper-only degenerate cases handled.
- UI: transcript panel renders speaker names; sidebar chip shows `diarized` flag.

## 2. Gaps → work items

### 2.1 Provider lock-in (highest value)

Merge is **hardcoded to Codex CLI**. Users on Ollama/Claude/etc. get no diarization.

**Change:** route the merge through the existing provider abstraction `summary/llm_client.rs::generate_summary()`-style entry (extract a generic `generate_text(provider, model, system, user, cancel_token)` if not already reusable) so diarization uses **the user's configured summary provider** by default, with an optional "diarization provider" override in settings for users whose summary model is too small for JSON-strict output.

Constraints to preserve: strict-JSON instruction, lenient parse + 3 retries (small local models fail JSON more often — retries matter more, consider bumping to 4 for BuiltInAI/Ollama), 600-item caps (token budget), cancellation token.

### 2.2 Manual speaker rename

LLM merge misattributes sometimes; names must be correctable.

- Transcript panel: click speaker chip → rename popover: rename **this segment** or **all segments by this speaker** (the common case).
- Persisted to `meeting_diarized_segments.speaker_name` via new command `api_rename_speaker(meeting_id, from, to, scope)`.
- Renames survive re-runs? No — re-run overwrites (atomic delete+insert). Acceptable; warn in the re-run confirm dialog ("manual renames will be lost").

### 2.3 Re-run + status visibility

- Meeting detail gets a **"Re-run diarization"** action (menu) — enabled when captions or transcript exist; shows provider being used; progress + failure toast with error detail (currently failures are silent-ish → surface `summary_processes`-style status; add `diarization_status` column on `meetings` or reuse an events table).
- Confidence display: segments with `confidence < 0.5` render the speaker chip in muted/dashed style with tooltip "low confidence — click to correct". Cheap trust signal.

### 2.4 Prompt improvement (small)

`DIARIZE_SYSTEM_PROMPT` additions: (a) explicit rule to prefer roster names over caption-derived spellings (dedup "Ali B." vs "Ali Bigdeli"), (b) instruction to keep Persian text verbatim and never translate, (c) forbid inventing speakers not in roster+captions union.

## 3. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/src/gmeet_ingest/diarize.rs` | provider-agnostic LLM call; prompt additions; status reporting |
| `frontend/src-tauri/src/summary/llm_client.rs` | expose generic single-shot `generate_text(...)` (refactor, no behavior change for summaries) |
| Settings (`SummaryModelSettings.tsx` or Beta→promoted section) | optional diarization-provider override |
| `frontend/src-tauri/migrations/…_diarization_status.sql` | `ALTER TABLE meetings ADD COLUMN diarization_status TEXT` |
| New commands | `api_rename_speaker`, `api_rerun_diarization`, `api_get_diarization_status` |
| `TranscriptPanel.tsx` | rename popover, confidence styling, re-run action |

## 4. Out of scope

- Acoustic/embedding-based diarization (pyannote-style) for non-GMeet meetings — big dependency; backlog (doc 11). Without Meet captions there is no name source anyway; acoustic would only yield "Speaker 1/2".
- Cross-meeting voice profiles.

## 5. Acceptance criteria

- [ ] Diarization succeeds with provider = Ollama (llama3.1-8b class) and Claude, not just Codex.
- [ ] Rename-all corrects every segment for a speaker in <1 s and persists.
- [ ] Re-run shows progress, overwrites atomically, warns about manual renames.
- [ ] Low-confidence segments visibly distinct.
- [ ] Failure path shows actionable error (provider name + message), fallback "Unknown" transcript still written.
