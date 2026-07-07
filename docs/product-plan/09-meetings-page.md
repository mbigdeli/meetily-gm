# 09 — Meetings Page (Library Redesign)

> Phase 1 · Effort: ~1 week (within redesign track) · Covers user request #8 · Sibling of doc 13 (app redesign)

---

## 1. Goal

Replace "meetings live in a cramped, endlessly-scrolling sidebar" with a **dedicated Meetings page**: a full-width, information-rich library with recorded date, duration, participants, status, and user actions — **star** and **priority** included.

## 2. Current state (verified)

- Only surface: `frontend/src/components/Sidebar/` (`SidebarProvider.tsx` state + `index.tsx` render) — title, created date, status chip (`MeetingStatusChip.tsx`: summary status + diarized flag), delete/edit/export menu, transcript search box.
- Data: `meetings (id, title, created_at, updated_at, folder_path)`; fetched by `api_get_meetings` (`ORDER BY created_at DESC`).
- No duration, participants, star, priority anywhere.

## 3. Data model changes

Migration `…_meetings_library.sql`:

```sql
ALTER TABLE meetings ADD COLUMN starred     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN priority    TEXT NOT NULL DEFAULT 'none';  -- none|normal|high
ALTER TABLE meetings ADD COLUMN duration_sec REAL;                          -- backfill from transcripts max(audio_end_time)
CREATE INDEX idx_meetings_starred  ON meetings(starred);
CREATE INDEX idx_meetings_priority ON meetings(priority);
```

Backfill duration in the migration (`UPDATE meetings SET duration_sec = (SELECT MAX(audio_end_time) FROM transcripts t WHERE t.meeting_id = meetings.id)`); new recordings write it at stop-recording time.

List query becomes one aggregate join (single Tauri command `api_get_meetings_library(filter, sort, page)`):

```sql
SELECT m.*, COUNT(DISTINCT p.id) AS participant_count,
       sp.status AS summary_status,
       EXISTS(SELECT 1 FROM meeting_diarized_segments d WHERE d.meeting_id=m.id) AS diarized
FROM meetings m
LEFT JOIN meeting_participants p ON p.meeting_id=m.id
LEFT JOIN summary_processes sp    ON sp.meeting_id=m.id
GROUP BY m.id ORDER BY ... LIMIT 50 OFFSET ...;
```

## 4. UX (mockup: [mockups/meetings-list.html](mockups/meetings-list.html))

### 4.1 Layout

- New route `frontend/src/app/meetings/page.tsx`, reached from the persistent left nav (doc 13 §4: Home · **Meetings** · Integrations · Prompt Studio · Settings).
- **Toolbar:** search (existing `searchTranscripts` + title match), filters (Starred ★ · Priority · Status · Language · Has-GMeet-data · date range), sort (Date ▾ default · Duration · Title · Priority), view density toggle (comfortable/compact).
- **Table columns:** ★ (toggle) · Title (+ style icon from `style_id`) · Recorded (date+time, relative <7 d) · Duration · 👥 count · Status (summary/diarization chips — reuse `MeetingStatusChip`) · Priority flag · Sent-to badges (Slack/Jira delivery log, doc 10) · ⋯ row menu.
- Row click → meeting detail. 50/page (paged, not infinite — predictable for keyboard nav).

### 4.2 Actions

- **Star:** click ★ in row, optimistic toggle. Starred filter pinned as a toolbar tab ("All · Starred · High priority").
- **Priority:** flag cell cycles none→normal→high (or row-menu submenu); high = red flag + row tint.
- Row menu ⋯: Open · Rename · Star/Unstar · Priority ▸ · Export ▸ (summary md / transcript / participants CSV — docs 04) · Send to Slack (doc 08) · Delete (confirm).
- **Bulk:** checkbox column appears on first selection → bulk star, priority, delete, export.

### 4.3 Sidebar's new role

Sidebar shrinks to: record CTA + 5 most-recent meetings + "All meetings →" link. `SidebarProvider` remains the shared state source; the page consumes the same context (extend provider with library query state rather than duplicating fetch logic).

### 4.4 Empty/edge states

- No meetings → onboarding empty state with "Record your first meeting" + extension setup link.
- Search no-hits → "No meetings match" + clear-filters.
- Recording-in-progress row pinned top with live badge.

## 5. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/migrations/…_meetings_library.sql` | §3 |
| `frontend/src-tauri/src/database/repositories/meeting.rs` | library query, `set_starred`, `set_priority`, duration write |
| Commands | `api_get_meetings_library`, `api_set_meeting_starred`, `api_set_meeting_priority`, bulk variants |
| `frontend/src/app/meetings/page.tsx` (new) + `components/MeetingsLibrary/` (new) | table, toolbar, bulk bar |
| `frontend/src/components/Sidebar/*` | slim down; keep provider as source of truth |
| Recording stop path (`audio/recording_manager.rs` → meeting update) | persist `duration_sec` |

## 6. Acceptance criteria

- [ ] 200-meeting DB renders <100 ms per page; sort/filter combos correct (spot-check SQL).
- [ ] Star + priority persist, survive restart, reflected in sidebar recent list too.
- [ ] Bulk ops on 20 rows work; delete confirms once for the batch.
- [ ] Search hits transcript content (existing behavior) *and* titles; result rows show a snippet.
- [ ] Live recording appears pinned; finishing it updates the row without refresh (Tauri event).
- [ ] Keyboard: ↑/↓ row focus, Enter opens, `s` toggles star (a11y pass per doc 13 §7).
