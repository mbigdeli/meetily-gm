-- Prompt Studio templates (doc 06 §3). Additive: a first-class templates table
-- (UI term "template"; is_default marks the shipped ones) + the per-meeting
-- template_id. Default templates are seeded by code on first run (from the
-- existing built-in template set), not here, so their prompt bodies stay in one
-- place.
CREATE TABLE IF NOT EXISTS meeting_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    icon        TEXT,
    prompt_body TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

ALTER TABLE meetings ADD COLUMN template_id TEXT REFERENCES meeting_templates(id);
