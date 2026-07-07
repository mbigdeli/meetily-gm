# 06 — Prompt Studio (Meeting Styles)

> Phase 1 · Effort: ~1 week · Covers user request #5

---

## 1. Goal

A first-class **Prompt Studio** section in Settings where the user creates, edits, and manages **Meeting Styles** — named prompt templates that fully control what is sent to the LLM for summarization. Contract:

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

New table (styles move from loose JSON files into SQLite — consistent with the rest of the app; JSON files remain an import/export format):

```sql
CREATE TABLE meeting_styles (
  id          TEXT PRIMARY KEY,            -- uuid
  name        TEXT NOT NULL UNIQUE,        -- "Standup", "Client call", "جلسه استاندارد"
  description TEXT,
  icon        TEXT,                        -- emoji/token for pickers
  prompt_body TEXT NOT NULL,               -- full user-editable prompt with {{variables}}
  is_builtin  INTEGER NOT NULL DEFAULT 0,  -- seeded styles: editable but "Reset to default" available
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
ALTER TABLE meetings ADD COLUMN style_id TEXT REFERENCES meeting_styles(id); -- style used per meeting
```

Migration seeds `meeting_styles` by converting each existing built-in JSON template into a `prompt_body` (sections flattened into instruction text). Two Persian styles added (doc 03 §3.4). User's existing custom JSON templates in `%APPDATA%` are imported on first run (one-time, keep files untouched).

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

Replaces the Beta template dropdown + custom-prompt override (Beta keeps only genuinely experimental toggles). Layout (mockup: [mockups/prompt-studio.html](mockups/prompt-studio.html)):

**Left: style list**
- Seeded + user styles, drag to reorder (`sort_order`), icon + name + description.
- Actions: New style · Duplicate · Delete (built-ins: no delete, "Reset to default" instead) · Import/Export JSON.

**Right: editor**
- Name, description, icon fields.
- **Prompt body**: monospace textarea (large), with:
  - Variable palette — click chip (`{{transcript}}`, `{{participants}}`, …) inserts at cursor; chips show live tooltip of what they expand to.
  - Inline validation: required-variable state, unknown-variable warnings.
  - Token estimate footer (chars/4 heuristic) + model-context hint.
- **Preview** button: renders the prompt with variables expanded from a selected past meeting (picker), shows the exact final text that would be sent. This is the trust feature — "what you see is what the LLM gets."
- **Test run** button (optional, nice-to-have): sends preview to the configured provider, shows output in a drawer. Reuses existing `generate_summary` path with a `dry-run` label; respects cancellation.

**Style selection at use time**
- Recording start: style select (default = last used / global default).
- Meeting detail: "Regenerate summary" exposes style switcher.
- `meetings.style_id` records what was used.

## 6. Prompt assembly changes (`summary/processor.rs`)

Current: template sections → system prompt; transcript chunks → user prompt. New:

1. Resolve style → expand variables **except** `{{transcript}}`.
2. System prompt = minimal fixed wrapper only: output-format instruction (markdown, heading levels compatible with BlockNote rendering) + language directive (doc 03). *No hidden content instructions* — the style body is the contract.
3. `{{transcript}}` placement: style body is split at the variable; transcript injected at that point.
   **Chunking:** when transcript exceeds the provider's context budget, keep the existing chunk→partial→merge strategy: each chunk pass uses the style body with `{{transcript}}` = chunk; merge pass uses a fixed merge prompt + the style's section intent. Document in editor help: "Long meetings are processed in parts; your prompt runs on each part."
4. Custom-prompt fingerprint cache (`service.rs`) keys on `style_id + updated_at` — cache invalidates on style edit (mechanism already exists for custom prompts; rewire).

## 7. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/migrations/…_meeting_styles.sql` | table + meetings.style_id + seed |
| `frontend/src-tauri/src/summary/styles.rs` (new) | model, CRUD repo, variable expansion + validation |
| `frontend/src-tauri/src/summary/template_commands.rs` | extend to style commands: `api_list_styles`, `api_save_style`, `api_delete_style`, `api_reset_style`, `api_preview_style(meeting_id, style_id)`, `api_import_style_json`, `api_export_style_json` |
| `frontend/src-tauri/src/summary/processor.rs` | assembly per §6 |
| `frontend/src/app/settings/page.tsx` | new Prompt Studio tab |
| `frontend/src/components/PromptStudio/` (new) | list, editor, variable palette, preview drawer |
| `frontend/src/components/BetaSettings.tsx` | remove template dropdown + custom prompt override (migrated) |

## 8. Edge cases

- Style deleted while set as a meeting's `style_id` → regenerate falls back to default style with notice (FK is soft; keep id for history display "used deleted style X").
- Empty transcript (no speech) → block generation with clear message before any LLM call.
- Very large `{{participants}}` (50+) → cap at 30 names + "and N more".
- Import of old sections-JSON template files → converter produces a prompt body (same as migration seeder); invalid JSON → error with line info (reuse `api_validate_template` logic).

## 9. Acceptance criteria

- [ ] Cannot save style without `{{transcript}}`; all optional variables expand correctly (unit-tested).
- [ ] Preview shows byte-exact prompt later sent to provider (verified via debug log comparison).
- [ ] Six seeded styles + two Persian styles present after migration; editing a built-in then "Reset to default" restores original.
- [ ] Old custom JSON templates auto-imported once.
- [ ] Summary generation uses selected style verbatim; regenerating with a different style produces correspondingly different output.
- [ ] Export→Import round-trips a style losslessly.
