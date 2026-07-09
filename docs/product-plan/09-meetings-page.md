# 09 — Meetings Page (Library Redesign)

> Phase 1 · Effort: ~1 week (within redesign track) · Covers user request #8 · Sibling of doc 13 (app redesign)

---

## 1. Goal

Replace "meetings live in a cramped, endlessly-scrolling sidebar" with a **dedicated Meetings page**: a clean, minimal library table with recorded date, duration, participant count, and multi-select. **Keep it minimal** (user directive) — only the columns that earn their place.

**Design decisions (user, this round):**
- **Checkbox column** for multi-select (real checkboxes, not stars).
- **Star** is a separate simple marker/favourite — one click toggles it; a "Starred" filter uses it. Star is **not** the multi-select mechanism.
- **Removed** from the table: Status column, "Sent to" column, Priority (dropped entirely).
- **No "New recording" button** on this page — recording lives only in the left-nav **Record** entry (don't repeat the record CTA on every page).

## 2. Current state (verified)

- Only surface: `frontend/src/components/Sidebar/` (`SidebarProvider.tsx` state + `index.tsx` render) — title, created date, status chip (`MeetingStatusChip.tsx`: summary status + diarized flag), delete/edit/export menu, transcript search box.
- Data: `meetings (id, title, created_at, updated_at, folder_path)`; fetched by `api_get_meetings` (`ORDER BY created_at DESC`).
- No duration, participants, star, priority anywhere.

## 3. Data model changes

Migration `…_meetings_library.sql`:

```sql
ALTER TABLE meetings ADD COLUMN starred      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN duration_sec REAL;   -- backfill from transcripts max(audio_end_time)
CREATE INDEX idx_meetings_starred ON meetings(starred);
```

(No `priority` column — dropped per user direction. If priority is ever revisited, add it then.)

Backfill duration in the migration (`UPDATE meetings SET duration_sec = (SELECT MAX(audio_end_time) FROM transcripts t WHERE t.meeting_id = meetings.id)`); new recordings write it at stop-recording time.

List query becomes one aggregate join (single Tauri command `api_get_meetings_library(filter, sort, page)`):

```sql
SELECT m.id, m.title, m.created_at, m.duration_sec, m.starred,
       COUNT(DISTINCT p.id) AS participant_count
FROM meetings m
LEFT JOIN meeting_participants p ON p.meeting_id = m.id
GROUP BY m.id ORDER BY ... LIMIT 50 OFFSET ...;
```

(Summary/diarization status is still shown *inside* the meeting detail, doc 13 §4.3 — just not as a library column.)

## 4. UX (mockup: [mockups/meetings-list.html](mockups/meetings-list.html))

### 4.1 Layout (minimal)

- New route `frontend/src/app/meetings/page.tsx`, reached from the persistent left nav (doc 13 §4).
- **Toolbar:** search only, plus two filter chips — `All` · `★ Starred`. Sort defaults to Date ↓ (a small sort control is enough; no density toggle, no status/priority/language filters cluttering v1).
- **Table columns (7, tight):** `☐` select · `★` marker · **Title** · **Recorded** (date+time, relative <7 d) · **Duration** · **👥** count · `⋯` row menu. Nothing else.
- Row click → opens the meeting detail (doc 13 §4.3). The checkbox and star each stop propagation so clicking them doesn't open the meeting. 50/page, paged.

### 4.2 Actions

- **Multi-select:** row checkboxes + a header select-all. When ≥1 checked, a slim bulk bar appears: Star · Export · Delete. (No priority.)
- **Star:** click the ★ cell to favourite; drives the "Starred" filter. Purely a marker — independent of selection.
- **Row menu ⋯:** Open · Rename · Star/Unstar · Export ▸ (see §4.5) · Delete (confirm).

### 4.3 Sidebar's new role

Sidebar shrinks to: the **Record** nav entry + a short recent list + "All meetings →". `SidebarProvider` stays the shared state source; the page consumes the same context. No record button is duplicated onto content pages.

### 4.4 Empty/edge states

- No meetings → minimal empty state: "No meetings yet — hit Record" + extension-setup link.
- Search no-hits → "No meetings match" + clear.
- Recording-in-progress → a single live indicator in the sidebar (doc 13), not a special table row.

### 4.5 Export (what & format — answers the user's question)

Two export scopes, both offered from the row menu / detail:

**A. Export a meeting** → user picks format:
- **Markdown (`.md`)** — the default, most portable. Contains, in order: title; date/time + duration; participants (name + approx attendance); the **summary** (with key decisions + action items); then the **full diarized transcript** (`[mm:ss] Speaker: text`). This is the "give me the whole meeting as one file" export.
- **PDF** — same content, print-styled (via the OS print-to-PDF path or a light HTML→PDF; no heavy dependency).
- **JSON** — structured envelope `{ meeting:{id,title,date,duration,language}, participants:[…], summary:{…}, segments:[{start,end,speaker,text}] }` for power users / re-import.
- **Copy summary** — summary only, to clipboard (already exists; keep).

**B. Export participants only** → CSV/JSON/MD (spec in [04-participants-export.md](04-participants-export.md)).

Encoding: UTF-8 **with BOM** for CSV (so Excel renders Persian names correctly). Filenames: `<title>-<date>.md`. Saved via Tauri dialog (`downloadDir` default — never hardcode paths).

Bulk export (multi-select) writes one file per meeting into a chosen folder, or a single combined `.md` — user picks in the export dialog.

## 5. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/migrations/…_meetings_library.sql` | §3 |
| `frontend/src-tauri/src/database/repositories/meeting.rs` | library query, `set_starred`, duration write |
| Commands | `api_get_meetings_library`, `api_set_meeting_starred`, `api_export_meeting(id, format)`, bulk variants |
| `frontend/src/app/meetings/page.tsx` (new) + `components/MeetingsLibrary/` (new) | table, toolbar, bulk bar |
| `frontend/src/components/Sidebar/*` | slim down; keep provider as source of truth |
| Recording stop path (`audio/recording_manager.rs` → meeting update) | persist `duration_sec` |

## 6. Acceptance criteria

- [ ] 200-meeting DB renders <100 ms per page; sort + Starred filter correct.
- [ ] Checkbox multi-select and ★ marker are independent; clicking either does not open the meeting; both persist across restart.
- [ ] Only 7 columns render; no status/sent-to/priority anywhere on the page.
- [ ] No "New recording" button on the page; Record reachable only from the nav.
- [ ] Bulk ops on 20 rows work; delete confirms once for the batch.
- [ ] Export produces a valid `.md` containing summary + diarized transcript + participants; CSV opens in Excel with Persian names intact (UTF-8 BOM).
- [ ] Search hits transcript content and titles; result rows show a snippet.
- [ ] Keyboard: ↑/↓ row focus, Enter opens, `s` toggles star (a11y pass per doc 13 §7).
