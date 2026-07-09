# 13 — App Redesign (UX/UI)

> Phase 1 foundation · Effort: ~1.5 weeks (foundation) + absorbed into each feature · Basis: design critique of current UI (screenshots `docs/home.png`, `docs/summary.png`, `docs/settings.png`) + feature requirements from docs 04–10

---

## 0. Revision 2 — user feedback (authoritative; overrides anything below it)

Live prototype: **[mockups/](mockups/)** (single-file interactive build; open in browser).

Guiding rule the user set: **minimal always.** Don't put lots of options/info on every screen — show the most important thing and the primary action, nothing more.

1. **Home is minimal** (the old redesign home was too busy). Just: one big Record button, an optional title field, and a single quiet line for template/language/model with an "options" link. No hint cards, no recent list crowding the page. Closer to the original Meetily home the user liked.
2. **Meetings page:** checkbox column for multi-select; **★ is a separate favourite marker**, not the select control. **Removed:** Status column, "Sent to" column, and Priority (dropped entirely). Kept minimal (see doc 09).
3. **No "New recording" button repeated on pages.** Record lives only in the left nav. (If a global shortcut is ever wanted, a single bottom-right circle — but the user prefers not having it everywhere.)
4. **Meeting detail is NOT a nav item** — it opens when a meeting row is clicked. **One column** (no two-column split): Summary → Suggested tasks (embedded right under the summary) → Participants (collapsible simple list) → Transcript (collapsed by default).
5. **"Send to Slack" was confusing** → replaced by a **Share ▾** menu that names exactly what happens: "Post recap (summary + action items) to Slack #channel", "Publish page to Notion", "Export (.md/.pdf)", "Copy summary". The recap = the summary + decisions + action items.
6. **Integrations = a vertical list of rows**, not rectangle cards; each Connect opens a real step-by-step modal (see doc 10 §7).
7. **The MCP block is renamed "Ask AI about your meetings"** with plain-language copy + example questions (doc 10 §6).
8. **Prompt Studio → term is "template"** (matches main app), no tag chips (two plain groups: Default / Your), Persian names render LTR in the list, screen de-crowded (doc 06).
9. **Persian font Vazirmatn** is embedded for all Persian (`.fa`) text — bundled locally in the app (doc 03 §3.2), demonstrated in the prototype via inlined woff2.

## 1. Design critique of the current app

### Overall impression
A capable engine wearing a generic shell: clean whitespace and a decent two-pane reading experience, but navigation hides the product's core object (meetings), toolbars grew by accretion, and the strongest features (diarization, participants, styles) are invisible. Nothing about the visual identity says "Miting".

### Findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| C1 | **Meetings are buried.** Icon-only rail + collapsible panel; the meetings list is a cramped scroll column with title + date only. The product's primary noun has no page. | 🔴 | home.png rail; user request #8 |
| C2 | **Toolbar overload / unclear ownership.** Summary view shows two toolbars in one header row: left pane (Copy · Recording) and right pane (Generate Note · AI Model · Template · Save · Copy · folder). Two different "Copy" buttons visible at once; config actions (AI Model, Template) mixed with content actions (Save, Copy). | 🔴 | summary.png |
| C3 | **Action-items table overflows.** Columns truncate ("Seg… Tim…", "Nor…") with horizontal cut-off inside the pane. This exact surface must host Jira suggestion chips (doc 07) — it cannot, as-is. | 🔴 | summary.png |
| C4 | **Diarization invisible where it matters.** Transcript pane shows raw timestamped text without speaker names even when diarized segments exist; the flagship feature reads as absent. | 🔴 | summary.png vs `meeting_diarized_segments` |
| C5 | **Recording state underweighted.** "Recording • 02:44" is a light gray pill; the floating pause/stop control is good but disconnected from it. | 🟡 | home.png |
| C6 | **Config-as-toolbar.** Model / Devices / Language sit as top-level buttons on the recording screen — session setup mixed with in-session actions. | 🟡 | home.png |
| C7 | **Settings navigation is modal-ish.** "← Back / Settings" page with tabs breaks the sense of place; no room for the new Integrations & Prompt Studio sections. | 🟡 | settings.png |
| C8 | **No RTL/localization affordances** in any surface; long Persian titles/text will break alignment assumptions. | 🟡 | doc 03 |
| C9 | **Visual identity is default.** Pencil mark, stock grays + red record accent, lowercase "meetily" title; nothing ownable. | 🟡 | all |
| C10 | What works: two-pane transcript/summary reading layout; floating record controls; card-based settings groups; whitespace discipline. **Keep these.** | 🟢 | all |

## 2. Information architecture (new)

Persistent **left nav (labeled, not icon-only)** — collapsible to icons, defaults expanded ≥1200 px:

```
● Record            (home: start/monitor recording)
▤ Meetings          (library page — doc 09)
⇄ Integrations      (hub — doc 10 §7)
✎ Prompt Studio     (meeting styles — doc 06)   [entry also under Settings]
⚙ Settings          (General · Recording · Transcription · Summary · Advanced)
ⓘ About             (doc 01 §5)
```

- Sidebar bottom: recording-in-progress mini-card (live dot + elapsed + jump), replacing C5's weak pill as the *global* recording indicator visible from any page.
- Meeting detail is a routed page (`/meetings/[id]`), not a sidebar swap — back button, shareable position, browser-like history (Next.js router already available).

## 3. Design system (tokens)

Implemented as CSS variables + Tailwind config; shadcn/ui-style component conventions (Button, Card, Dialog, DropdownMenu, Tabs, Table, Toast, Badge, Command palette) — components hand-rolled or vendored, no runtime dependency change beyond what exists.

| Token group | Decision |
|---|---|
| **Color — brand** | Deep indigo-navy primary `--brand: #3D5AFE`-family (ownable vs competitor greens/purples); record/live stays red `#E5484D`; success `#30A46C`; warning `#F5A524` |
| **Neutrals** | Slate ramp, `--bg` warm-white `#FAFAF9` light / `#111113` dark; **dark mode is first-class** (PM evening work; toggle in Settings → General, follows OS default) |
| **Typography** | UI: Inter (or system-ui stack); transcripts keep a reading-optimized serifless size 15/1.7; Persian: Vazirmatn joins the stack (doc 03 §3.2); numerals tabular in tables/timestamps |
| **Spacing/radius** | 4-px grid; radius 10 (cards) / 8 (controls); focus ring 2 px brand at 60 % |
| **Elevation** | borders-first, shadow only for floating layers (record controls, popovers) |
| **Direction** | All new/touched components use **logical properties** (`ps/pe/ms/me`, `text-start`) — RTL-ready by construction (C8) |
| **Motion** | 150 ms ease-out standard; live-transcript segments fade-slide in; reduced-motion respected |

## 4. Screen-by-screen spec

### 4.1 Record (home) — fixes C5, C6

- **Idle:** centered start card — big Record button, meeting title input, style select (doc 06), language select (doc 03), device summary line with "change" popover (Model/Devices/Language leave the toolbar → session-setup card; C6 resolved). Below: last 3 meetings (quick resume into library).
- **Live:** transcript stream full-width (speaker chips appear live once gmeet captions provide hints), sticky top status bar: red dot, elapsed, meeting title (editable inline), audio level meters; floating controls (pause/stop) stay — they work (C10).
- Mockup: [mockups/home.html](mockups/home.html)

### 4.2 Meetings library — doc 09 (C1)

Full spec in doc 09. Mockup: [mockups/meetings-list.html](mockups/meetings-list.html)

### 4.3 Meeting detail — fixes C2, C3, C4

Header: title (inline edit) · date/duration/style badges · ★ · priority flag · **primary actions:** `Send to Slack` `Find tasks` `⋯` (export, re-run pipeline, delete). *One* toolbar, verbs only (C2).

Body — three tabs replacing the crowded two-pane split, default **Overview**:

| Tab | Content |
|---|---|
| **Overview** | Summary (BlockNote, existing) + **Suggested tasks** cards w/ multi-select + Jira flow (doc 07 §4.2) + Participants strip w/ talk-time (doc 04) + delivery badges (doc 10) |
| **Transcript** | Diarized segments: speaker chip (color-hashed per speaker, rename popover — doc 05) + timestamp + text; per-segment `dir` (C4, C8); search-in-transcript; click-to-copy segment |
| **Details** | style used, model/provider, language, files (recording path), pipeline status + re-run buttons |

Action-items render as **cards, not a fixed table** (C3): owner avatar-chip, task, due — wrapping naturally in the pane; table layout only on export.
Regenerate summary: split-button on Overview (`Regenerate ▾` → style picker) — replaces Generate Note/AI Model/Template toolbar cluster (C2).
Mockup: [mockups/meeting-detail.html](mockups/meeting-detail.html)

### 4.4 Integrations hub — doc 10 §7. Mockup: [mockups/integrations.html](mockups/integrations.html)

### 4.5 Prompt Studio — doc 06 §5. Mockup: [mockups/prompt-studio.html](mockups/prompt-studio.html)

### 4.6 Settings (C7)

Becomes a nav destination (no "Back"): left sub-nav within the page — General · Recording · Transcription · Summary · Advanced (analytics consent, data locations, updates). Beta tab dissolves: Codex → Summary providers; diarization → Transcription; templates → Prompt Studio; gmeet status → Integrations.

### 4.7 Onboarding (first run)

3 steps max: ① consent (analytics opt-in, existing component) → ② pick transcription model (download progress inline) → ③ pick summary provider (Codex sign-in / Ollama detect / key). Google Meet extension setup offered as a dismissible card on Record page, not a blocking step.

## 5. UX copy principles (selected microcopy)

- Voice: capable colleague, not mascot. No exclamation marks in system messages.
- Empty states teach: Meetings — "No meetings yet. Hit Record, or install the Meet companion to capture Google Meet calls." (+ button)
- Errors are actionable and honest: "Jira rejected the issue: 'customfield_10021 is required'. Open Jira's create screen ↗ or pick another project."
- Destructive confirms name the object: "Delete 'Sprint planning — Jul 3'? The recording and transcript are removed from this device."
- Live states: "Listening…" (kept — good), "Summarizing with Ollama · llama3.1 …"
- Persian UI strings (L2) deferred, but all copy written to survive translation (no idioms).

## 6. Accessibility

- WCAG 2.1 AA contrast on both themes (brand-on-white ≥4.5 for text, verified per token).
- Full keyboard map: global `Ctrl+K` command palette (navigate/search meetings — cheap with existing search), `R` start/stop record w/ confirm, table nav per doc 09 §6.
- Focus visible everywhere; dialogs trap focus; toasts announced via `aria-live="polite"`.
- Speaker-chip colors never sole differentiator (name always shown); RTL verified with Farsi fixtures (doc 03 test matrix).

## 7. Rollout & file impact

Foundation PR series (order): tokens + dark mode → nav shell + routes → meeting detail tabs → settings restructure. Each feature doc then lands inside the new shell.

| Area | Files |
|---|---|
| Tokens/theme | `frontend/src/app/globals.css`, `tailwind.config.*`, theme provider in `layout.tsx` |
| Nav shell | `frontend/src/components/AppShell/` (new), slim `Sidebar/` (doc 09 §4.3) |
| Meeting detail | `frontend/src/app/meetings/[id]/page.tsx` (new), refactor `AISummary/`, `TranscriptPanel.tsx` into tabs |
| Settings | `frontend/src/app/settings/page.tsx` restructure; dissolve `BetaSettings.tsx` |
| Onboarding | `frontend/src/components/onboarding/` rework (3 steps) |

## 8. Acceptance criteria

- [ ] Every screen reachable in ≤2 clicks from nav; meetings never require the old collapsible panel.
- [ ] One toolbar per view; no duplicate-verb buttons visible simultaneously (C2 audit).
- [ ] Action items never overflow horizontally at 1024-px window (C3).
- [ ] Diarized meetings show speaker chips in Transcript tab by default (C4).
- [ ] Dark mode complete (no unthemed surfaces); AA contrast spot-checks pass.
- [ ] Farsi meeting renders correctly across Record-live, Transcript tab, Overview (C8).
- [ ] Command palette navigates to any meeting by title search.
