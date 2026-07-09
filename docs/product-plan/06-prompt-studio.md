# 06 — Prompt Studio (Meeting Templates)

> Phase 1 · Effort: ~1 week · Covers user request #5

---

## Terminology & UI decisions (user, this round)

- Call them **templates**, not "styles" — matches the term the rest of the app already uses (the summary view's **Template** button). Use "template" everywhere in code and UI.
- **No tag chips** ("built-in" / "yours"). Instead the list has two plain section headers: **Default templates** (ship with Miting, editable, with "Reset to default") and **Your templates** (user-created). That conveys what "built-in" meant without a tag.
- Persian template names render **LTR like the rest of the list** (don't right-align a single item — keep the list visually uniform); the *prompt body* and its output stay RTL where the content is Persian.
- **Keep the screen minimal.** One editor, a compact variable row, a Preview and a Save — no token-estimate clutter, no crowding.

## 1. Goal

A first-class **Prompt Studio** section where the user creates, edits, and manages **templates** — named prompts that fully control what is sent to the LLM for summarization. Contract:

- Every style **must** contain the `{{transcript}}` variable — it is the one required placeholder; a style cannot be saved without it.
- Everything else in the prompt is **free text, fully user-editable**, with optional variables available.
- Whatever the style says **is** the prompt sent to the LLM (plus a minimal system wrapper for output formatting) — no hidden rewriting.

## 2. Current state (verified)

| Piece | File |
|---|---|
| 6 built-in JSON templates (sections model: title/instruction/format) | `frontend/src-tauri/templates/*.json` (standard_meeting, daily_standup, project_sync, retrospective, sales_marketing_client_call, psychatric_session) |
| Custom templates dir | `%APPDATA%\Meetily\templates\` |
| Template loader + validation | `frontend/src-tauri/src/summary/templates/` (`mod.rs`, `loader.rs`), commands `api_list_templates`, `api_get_template_details`, `api_validate_template` (`template_commands.rs`) |
| Prompt assembly | `summary/processor.rs::generate_meeting_summary()` — system prompt from `template.to_markdown_structure()` + `to_section_instructions()`; user prompt = chunked transcript + language directive |
| Ad-hoc custom prompt override (session-only) | `BetaSettings.tsx` + `summary/service.rs` (fingerprinted for cache invalidation) |
| Template picker | Beta settings dropdown |

**Direction:** evolve, don't replace. The sections-based JSON model remains the *storage* backbone (it chunks well and produces structured output); Prompt Studio adds a **prompt-first authoring layer** on top, and the six built-ins become seeded, editable styles.

## 3. Data model

New table (templates move from loose JSON files into SQLite — consistent with the rest of the app; JSON files remain an import/export format). Table named `meeting_templates` (UI term = "template"):

```sql
CREATE TABLE meeting_templates (
  id          TEXT PRIMARY KEY,            -- uuid
  name        TEXT NOT NULL UNIQUE,        -- "Standup", "Client call", "Standard meeting (فارسی)"
  description TEXT,
  icon        TEXT,                        -- emoji/token for pickers
  prompt_body TEXT NOT NULL,               -- full user-editable prompt with {{variables}}
  is_default  INTEGER NOT NULL DEFAULT 0,  -- ships with Miting → shown under "Default templates", has "Reset to default"
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
ALTER TABLE meetings ADD COLUMN template_id TEXT REFERENCES meeting_templates(id); -- template used per meeting
```

`is_default` (was "is_builtin") is what the UI conveys as the **Default templates** group — no tag chip needed. Migration seeds `meeting_templates` by converting each existing built-in JSON template into a `prompt_body` (sections flattened into instruction text). Two Persian templates added (doc 03 §3.4). User's existing custom JSON templates in `%APPDATA%` are imported on first run (one-time, keep files untouched).

## 4. Variable system

| Variable | Required | Expansion |
|---|---|---|
| `{{transcript}}` | **YES — save blocked without it** | Diarized transcript when available (`speaker: text` lines), else raw Whisper text. Chunking: see §6. |
| `{{meeting_title}}` | optional | `meetings.title` |
| `{{date}}` | optional | meeting local date |
| `{{duration}}` | optional | `HH:MM` from audio duration |
| `{{participants}}` | optional | comma list from `meeting_participants` (doc 04), "unknown" if empty |
| `{{language}}` | optional | resolved meeting language name ("Persian") |
| `{{my_name}}` | optional | `is_self` participant, for "my action items" prompts |

Rules:
- Unknown `{{...}}` tokens → validation **warning** (not error): "Unknown variable will be sent literally."
- Missing `{{transcript}}` → save disabled + inline error.
- Escaping: `\{\{` renders literal braces (edge case, documented in the editor help).
- Expansion is plain string substitution in Rust (no template engine dependency); implement in `summary/styles.rs` (new) with unit tests for all variables + escaping.

## 5. UX — Settings → Prompt Studio (new tab)

Replaces the Beta template dropdown + custom-prompt override (Beta keeps only genuinely experimental toggles). Minimal two-pane layout (mockup: [mockups/prompt-studio.html](mockups/prompt-studio.html)):

**Left: template list** — two plain section headers, no tag chips:
- **Default templates** — ship with Miting; editable, with "Reset to default" (no delete).
- **Your templates** — user-created; duplicate/delete freely.
- Persian names render LTR like every other row (uniform list); reorder via `sort_order`. Import/Export JSON at the bottom.

**Right: editor** (kept lean):
- Name field (that's it up top — description/icon optional, tucked away).
- **Prompt body**: one monospace textarea + a compact **variable row** — click a chip (`{{transcript}}` required, `{{participants}}`, `{{date}}`, `{{duration}}`, `{{meeting_title}}`) to insert at cursor. Required `{{transcript}}` chip is outlined; missing it disables Save.
- Footer: a single line — "✓ includes required {{transcript}}" and "Preview shows the exact text sent to your AI". No token-estimate widget in the main view (move any token hint into Preview).
- **Preview** button: expands variables against a chosen past meeting and shows the byte-exact final prompt. The trust feature — what you see is what the model gets. (Optional Test-run lives inside Preview, not as a second top-level button.)

**Template selection at use time**
- Recording start: template select (default = last used).
- Meeting detail: "Regenerate summary ▾" exposes the template switcher.
- `meetings.template_id` records what was used.

## 6. Prompt assembly changes (`summary/processor.rs`)

Current: template sections → system prompt; transcript chunks → user prompt. New:

1. Resolve template → expand variables **except** `{{transcript}}`.
2. System prompt = minimal fixed wrapper only: output-format instruction (markdown, heading levels compatible with BlockNote rendering) + language directive (doc 03). *No hidden content instructions* — the template body is the contract.
3. `{{transcript}}` placement: template body is split at the variable; transcript injected at that point.
   **Chunking:** when transcript exceeds the provider's context budget, keep the existing chunk→partial→merge strategy: each chunk pass uses the template body with `{{transcript}}` = chunk; merge pass uses a fixed merge prompt + the template's section intent. Document in editor help: "Long meetings are processed in parts; your prompt runs on each part."
4. Prompt fingerprint cache (`service.rs`) keys on `template_id + updated_at` — cache invalidates on template edit (mechanism already exists for custom prompts; rewire).

## 7. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/migrations/…_meeting_templates.sql` | table + meetings.template_id + seed |
| `frontend/src-tauri/src/summary/templates_store.rs` (new) | model, CRUD repo, variable expansion + validation |
| `frontend/src-tauri/src/summary/template_commands.rs` | `api_list_templates`, `api_save_template`, `api_delete_template`, `api_reset_template`, `api_preview_template(meeting_id, template_id)`, `api_import_template_json`, `api_export_template_json` |
| `frontend/src-tauri/src/summary/processor.rs` | assembly per §6 |
| `frontend/src/app/settings/page.tsx` | new Prompt Studio tab |
| `frontend/src/components/PromptStudio/` (new) | list (two groups), lean editor, variable row, preview |
| `frontend/src/components/BetaSettings.tsx` | remove template dropdown + custom prompt override (migrated) |

## 8. Edge cases

- Template deleted while set as a meeting's `template_id` → regenerate falls back to the default template with a notice (FK is soft; keep id for history "used deleted template X").
- Empty transcript (no speech) → block generation with clear message before any LLM call.
- Very large `{{participants}}` (50+) → cap at 30 names + "and N more".
- Import of old sections-JSON template files → converter produces a prompt body (same as migration seeder); invalid JSON → error with line info (reuse `api_validate_template` logic).

## 9. Acceptance criteria

- [ ] UI says "template" everywhere; two list groups (Default / Your), no tag chips; Persian names render LTR in the list.
- [ ] Cannot save a template without `{{transcript}}`; all optional variables expand correctly (unit-tested).
- [ ] Preview shows byte-exact prompt later sent to provider (verified via debug log comparison).
- [ ] Default templates (6) + two Persian templates present after migration; editing a default then "Reset to default" restores original.
- [ ] Old custom JSON templates auto-imported once.
- [ ] Summary generation uses the selected template verbatim; regenerating with a different template changes output.
- [ ] Export→Import round-trips a template losslessly.
