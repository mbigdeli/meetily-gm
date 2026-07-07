# 11 — Feature Backlog: Ideas for Meeting-Heavy Professionals

> Phase 3+ · Covers user request #11 ("what else for PMs, tech leads, digital marketers?") · Prioritized by persona value ÷ effort, all local-first-compatible

---

## Scoring

**Value:** how often the persona hits the pain × how sharp it is. **Effort:** S ≤3 d · M ≤1.5 w · L >1.5 w. **P0** = build next after Phase 2 · **P1** = strong candidates · **P2** = opportunistic.

---

## P0 — build next

### 1. Cross-meeting Action-Item Tracker — PM/tech-lead · M
The single biggest gap between note tools and work tools: action items die inside individual meetings. A global **Actions** page aggregates `meeting_task_suggestions` (doc 07) across meetings: status (open/done/pushed-to-Jira), owner, source-meeting link. Detects **carry-over**: same normalized item appearing in consecutive recurring meetings gets a "raised 3rd time" badge — standup gold. Builds entirely on existing tables.

### 2. Weekly Digest / Stakeholder Update Generator — PM · S–M
Pick a date range (default: this week) → LLM digest of all summaries: key decisions, progress, risks, open actions. Output shaped by a Prompt Studio style (`{{summaries}}` variable — small extension to doc 06), export md / send to Slack / copy for email. PMs write this document every Friday by hand today; this is the retention feature.

### 3. Decision Log — PM/tech-lead · S
Extraction pass (same pattern as task extraction) for **decisions**: statement, decider, date, evidence quote → `meeting_decisions` table → searchable registry page with export. "When did we decide X and who agreed?" answered in seconds. Cheap, differentiating, compounds with digest.

### 4. Ask-Your-Meetings (local RAG chat) — all · L
Chat panel over the whole meeting corpus: embed transcript chunks locally (fastembed-rs or llama-helper embeddings into sqlite-vec), retrieve → answer with citations that deep-link into transcripts at the right segment. The "wow" demo feature and natural sibling of the MCP server (same retrieval layer serves both). Ship after MCP server proves the query patterns.

---

## P1 — strong candidates

### 5. Talk-Time & Meeting-Culture Analytics — PM/lead · S
Per-meeting: talk-time share per speaker (from `meeting_diarized_segments`, partially specced in doc 04), longest monologue, interruption-ish density. Trends page: meeting hours/week, cost estimate. Managers share screenshots of this — organic marketing.

### 6. Meeting Cost Calculator — exec-adjacent, marketers love it · S
`participants × duration × configurable avg hourly rate` shown on meeting detail + aggregate ("your meetings this month: ≈ $12,400"). Two days of work, endless LinkedIn-post material — fits the personal-branding strategy directly.

### 7. Follow-up Email Draft — PM/marketer · S
"Draft follow-up email" button → LLM produces recipient-ready email (recap + actions + thanks) from a Prompt Studio style → opens `mailto:` / copies. Marketers sending client recaps daily.

### 8. Customer-Call Mode — marketer/PM-discovery · M
A meeting style + extraction preset for external calls: pain points, verbatim quotes (with speaker + timestamp), feature requests, objections, sentiment. Export CSV/Notion for research repositories. Turns Miting into a lightweight continuous-discovery tool (compare: Dovetail at $$$).

### 9. Recurring-Series Linking — tech-lead · M
Detect recurring meetings (title similarity + cadence, or manual "link series"). Series view: timeline of summaries, **"what changed since last time"** LLM diff, carried-over actions (feeds #1). Standups/weekly syncs stop being amnesiac.

### 10. Community Prompt-Template Gallery — branding flywheel · S (content) + M (in-app browser)
Public `miting-templates` repo where users PR meeting styles (JSON export from doc 06); in-app "Browse gallery" imports from it. Every contribution = community touchpoint = personal-brand reach. Start as repo-only (S), add in-app browser later.

---

## P2 — opportunistic

| Idea | Persona | Effort | Note |
|---|---|---|---|
| 11. Pre-meeting brief (context pack from prior series + open actions) | PM | M | needs #9; magical for back-to-backs |
| 12. Calendar context (auto-title/participants from Google Calendar) | all | M–L | OAuth verification burden → BYO-client only (research); revisit on demand |
| 13. Acoustic diarization for non-GMeet meetings (pyannote-class ONNX) | all | L | heavy dep; "Speaker 1/2" only — value unlocked when paired with rename UI (doc 05) |
| 14. Obsidian/Markdown-folder auto-export (vault sync) | tech-lead | S | file-watcher-friendly md export per meeting; cheap, PKM crowd is loud |
| 15. OKR/topic tagging + filter (manual tags v1) | PM | S | tags table + chips; auto-tagging later |
| 16. Snippet/highlight clips (select transcript range → share quote card image) | marketer | M | social-friendly artifact |
| 17. Live meeting HUD (real-time action-item capture hotkey) | all | L | overlaps recording UI redesign; defer until core stable |
| 18. Import from Otter/Fireflies export files | switchers | S–M | migration magnet for launch ("switch in 5 minutes") |
| 19. Meeting hygiene score (agenda present? overran? action ratio?) | PM-influencer | S | playful; shareable; pairs with #5/#6 |
| 20. Multi-track export (SRT/VTT subtitles from segments) | marketer (video) | S | trivial from `meeting_diarized_segments`; podcast/webinar teams |

---

## Explicit rejects (and why)

- **Cloud sync / team workspace** — breaks local-first promise; revisit only as E2E-encrypted opt-in, separate product decision.
- **In-app meeting bot that joins calls** — competitor pattern Miting positions *against*.
- **Mobile companion** — no capture story on mobile worth the maintenance.
- **Auto-send anything** — every outbound push stays behind explicit user confirmation (trust is the brand).

## Sequencing note

P0 #1–3 share the extraction/LLM plumbing built in Phase 2 (doc 07) — they are ~70 % UI work. Recommended post-Phase-3 order: **1 → 2 → 3 → 5 → 6 → 4 (RAG)**, inserting #18 (imports) just before any public launch push, and #10 (gallery repo) the week the Prompt Studio ships.
