# 04 — Participants Data & Export

> Phase 1 · Effort: 2–3 days · Covers user request #3

---

## 1. Goal

Every Google Meet meeting shows **who attended** (and when), and that data is exportable (CSV / JSON / Markdown) and reusable by other features (summary variable `{{participants}}` in doc 06, meetings-page column in doc 09, Jira assignee hints in doc 07).

## 2. Current state (verified)

- Extension roster tracker: `extension/src/content/capture/participants.ts` — extracts display names from Meet tiles/aria-labels, normalizes, confidence-scores; Persian names detected. Polled every **45 s** by `coordinator.ts`; snapshots sent via `session.participants` ingest action (port 17380).
- Storage: `meeting_participants (id, meeting_id, name, updated_at, UNIQUE(meeting_id, name))` — migration `20260706000000_add_gmeet_participants.sql`.
- **Gap:** no join/leave times, no host flag, no UI anywhere, no export.

## 3. Data model changes

Migration `…_participants_v2.sql`:

```sql
ALTER TABLE meeting_participants ADD COLUMN first_seen_at TEXT;   -- ISO8601, first snapshot containing name
ALTER TABLE meeting_participants ADD COLUMN last_seen_at  TEXT;   -- last snapshot containing name
ALTER TABLE meeting_participants ADD COLUMN is_self       INTEGER NOT NULL DEFAULT 0;  -- the recording user
ALTER TABLE meeting_participants ADD COLUMN source        TEXT NOT NULL DEFAULT 'gmeet'; -- future: manual, calendar
```

Ingest handler change: on each `session.participants` snapshot, upsert name → set `first_seen_at` if null, always bump `last_seen_at`. Join/leave are therefore **approximations at 45 s resolution** — labelled as such in UI ("joined ~10:02"). Attendance duration = `last_seen_at - first_seen_at` (approximate; good enough for attendance reporting).

`is_self`: extension knows the local user tile ("You") — pass through in the snapshot payload (`extension/src/shared/ingestTypes.ts` extension: `is_self?: boolean` per participant).

**Emails:** Meet DOM does not expose emails for external participants reliably — out of scope (documented limitation). Calendar integration (backlog, doc 11) is the future email source.

## 4. UX

### 4.1 Meeting detail — Participants section

New collapsible section in meeting view (placement per redesign, doc 13 §6.3):

- Avatar-initial chips: name + approx attendance time on hover; "(you)" badge for `is_self`.
- Count in header: "۶ participants" / "6 participants".
- Talk-time bar per participant when diarized segments exist (aggregate `meeting_diarized_segments` seconds by `speaker_name` matched to participant name) — this reuses diarization output for a Fireflies-grade insight, free.
- **Export button** → menu: CSV · JSON · Markdown · Copy as text.

### 4.2 Export formats

CSV: `name,first_seen,last_seen,approx_minutes,talk_seconds` (talk_seconds empty if not diarized).
JSON: same fields + meeting metadata envelope `{meeting_id, title, date, participants:[…]}`.
Markdown: table, ready to paste into Notion/Confluence.
File naming: `<meeting-title>-participants-<date>.csv`; save via Tauri dialog (`downloadDir` default — repo convention: never hardcode paths).

### 4.3 Meetings list

Participant count column (doc 09) reads `COUNT(*)` per meeting — cheap join, indexed by `meeting_id`.

## 5. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/migrations/…_participants_v2.sql` | columns above |
| gmeet ingest participants handler (`frontend/src-tauri/src/gmeet_ingest/`) | upsert with timestamps, is_self passthrough |
| `extension/src/shared/ingestTypes.ts` + `participants.ts` | `is_self` per entry |
| `frontend/src-tauri/src/database/repositories/` (new `participants.rs`) | `get_participants(meeting_id)`, `participants_with_talk_time(meeting_id)` |
| New Tauri commands | `api_get_participants`, `api_export_participants(meeting_id, format)` |
| `frontend/src/components/Participants/` (new) | section component + export menu |

## 6. Edge cases

- Same person rejoining with a different display name → two rows (accepted; manual merge is backlog).
- Name collision between two people → single row (Meet gives no stable ID; documented limitation).
- Non-GMeet (plain desktop-recorded) meetings → section shows empty state: "Participants are captured from Google Meet meetings" + link to companion-extension setup.
- Very long meetings across `session.end`/restart → `last_seen_at` monotonic guard.

## 7. Acceptance criteria

- [ ] GMeet recording produces roster with first/last-seen timestamps; self flagged.
- [ ] All 4 export formats produce valid output (CSV opens in Excel with Persian names intact — UTF-8 BOM required for Excel!).
- [ ] Talk-time bars appear on diarized meetings and sum ≈ meeting duration.
- [ ] Empty state on mic-only meetings.
