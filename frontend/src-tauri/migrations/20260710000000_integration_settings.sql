-- Integration connector secrets/config (doc 10). Stored in the DB, consistent
-- with how the app already stores provider API keys (user decision). Generic
-- key/value; key convention "<connector>.<field>", e.g. slack.bot_token,
-- jira.site, jira.email, jira.api_token, notion.token.
CREATE TABLE IF NOT EXISTS integration_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);
