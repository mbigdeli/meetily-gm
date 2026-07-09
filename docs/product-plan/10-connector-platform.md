# 10 — Connector Platform & Local MCP Server

> Phase 2 (base) + Phase 3 (MCP server, fast-follows) · Effort: 3–4 days base, ~1 week MCP server · Foundation for docs 07/08; flagship differentiator

---

## 1. Goal

One integration architecture so Jira (07) and Slack (08) aren't one-offs: shared secrets handling, shared action-item model, shared delivery log, and a connector interface that makes Notion/Linear/GitHub/Teams cheap fast-follows. Plus the **local MCP server** — the feature every paid competitor gates behind $14–59/user/mo, shipped free.

## 2. Connector interface (Rust)

`src-tauri/src/connectors/mod.rs`:

```rust
pub trait Connector {
    fn kind(&self) -> ConnectorKind;                    // Jira, Slack, Notion, ...
    async fn status(&self) -> ConnectionStatus;         // Disconnected | Connected(meta) | NeedsReauth(reason)
    async fn test(&self) -> Result<ConnectionMeta>;
    async fn disconnect(&self) -> Result<()>;
}
pub trait TaskSink: Connector {                          // Jira, Linear, GitHub, Trello...
    async fn destinations(&self) -> Result<Vec<Destination>>;   // projects/repos/lists
    async fn field_schema(&self, dest: &Destination) -> Result<FieldSchema>;
    async fn create_task(&self, dest: &Destination, task: &TaskDraft) -> Result<CreatedRef>; // key/url
}
pub trait MessageSink: Connector {                       // Slack, Teams...
    async fn channels(&self) -> Result<Vec<Channel>>;
    async fn send(&self, ch: &Channel, msg: &RecapMessage) -> Result<SentRef>;
}
```

`TaskDraft { title, body_markdown, labels, assignee_hint, due }` — markdown is the lingua franca; each connector converts (ADF for Jira, mrkdwn for Slack, blocks for Notion). UI popups (doc 07 §4.3) are transport-agnostic: the same suggest→draft→preview→confirm flow binds to any `TaskSink`.

## 3. Secrets

- Crate: `keyring` (Windows Credential Manager / macOS Keychain / Secret Service). Entry naming: `miting:<connector>:<field>` (e.g. `miting:jira:oauth_refresh`).
- SQLite `settings` stores only non-secret config (site URL, default project, channel MRU). **No tokens in DB** — hard rule, enforced in review.
- Disconnect = delete keyring entries + config row; export/backup never touches keyring.

## 4. Delivery log

```sql
CREATE TABLE integration_deliveries (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id),
  connector TEXT NOT NULL,           -- jira|slack|...
  kind TEXT NOT NULL,                -- task|recap|section
  ref_key TEXT, ref_url TEXT,        -- DB-457 / permalink
  payload_digest TEXT,               -- dedup/re-send warning
  created_at TEXT NOT NULL
);
```

Feeds: "Sent-to" badges on meetings page (doc 09), duplicate-send warnings (07/08), per-meeting activity strip in detail view.

## 5. Fast-follow connectors (priority order, research-backed)

| Connector | Auth | Core call | Effort | Notes |
|---|---|---|---|---|
| **Notion** | internal integration token (user creates, ~3 min) | `POST /v1/pages` into a chosen database | 2–3 d | Onboarding must explain share-database-with-integration gotcha; ~3 req/s limit; meeting-notes DB is the canonical PM pattern |
| **Linear** | personal API key (scopable to issue-create) | GraphQL `issueCreate`, markdown-native | 1 d | Tech-lead persona favorite; trivially clean API |
| **GitHub Issues** | **OAuth device flow** (client_id only — best desktop auth UX of all) or fine-grained PAT | `POST /repos/{o}/{r}/issues` | 1–2 d | Tech leads; markdown-native |
| **MS Teams** | Workflows (Power Automate) webhook — old O365 connectors retired 2026-05 | POST Adaptive Card | 1–2 d | Appears as "Flow bot"; corporate shops |
| **Confluence** | same Atlassian auth as Jira | `POST /wiki/api/v2/pages` (reuse ADF) | 1 d after Jira | publish full meeting notes page |
| Trello | key+token query params | `POST /1/cards` | 1 d | declining; demand-driven |
| Asana / ClickUp | PAT | REST create task | 1–2 d each | demand-driven |
| Monday / Google Calendar | — | — | defer | column-JSON fiddliness / OAuth verification burden |

Each lands as one `TaskSink`/`MessageSink` impl + a settings **row** (see §7) — no new UX invention.

### 5.1 "Are you sure you can connect to Notion / Linear / GitHub / Teams?" — yes (feasibility confirmed)

All four are **standard, documented integrations** a desktop app makes with the user's own credentials — no partnership or app-store approval needed:

| Tool | How Miting connects | Confidence |
|---|---|---|
| **Notion** | User creates a free internal integration at notion.so/my-integrations (~3 min), pastes the token, shares the target database with it. Miting calls `POST https://api.notion.com/v1/pages`. | **High** — public API |
| **Linear** | User generates a personal API key (Settings → Security & access), scopable to issue-create. Miting calls GraphQL `issueCreate` at `api.linear.app/graphql`, markdown-native. | **High** — trivial API |
| **GitHub Issues** | OAuth **device flow** (Miting ships only a public client_id, no secret — the ideal desktop pattern: user sees a code, approves in browser) or a fine-grained PAT. Then `POST /repos/{owner}/{repo}/issues`. | **High** — device flow built for this |
| **MS Teams** | User creates a "post to a channel when a webhook request is received" Workflow in Teams, pastes the URL; Miting POSTs an Adaptive Card. (Old O365 connector webhooks retired 2026-05 → Workflows is the current path.) | **High** — setup is a few clicks in Teams |

The honest caveat is **setup friction**, not feasibility: each needs the user to create a token/webhook once. None require Miting to be an approved app or run a cloud backend. Notion's one gotcha (must *share the database* with the integration) gets an explicit onboarding step. The in-app **Connect** button for each opens a short step-by-step modal (shown working in the prototype).

## 6. "Ask AI about your meetings" — the local MCP server, in plain language

**What it is, said plainly (this is how the UI must describe it — the abstract "MCP" label confused the user):**

> Miting can let an AI assistant you already use — **Claude, ChatGPT, or Cursor** — *read your meetings on this computer* so you can just ask it things in plain language:
> - *"What did we decide about pricing in the last two syncs?"*
> - *"List every open action item assigned to me this week."*
> - *"Summarise everything the Northwind customer asked for."*
>
> Nothing is uploaded — the assistant reads a local database on your machine. Competitors charge $14–19/user/mo for this; in Miting it's free.

**MCP** ("Model Context Protocol") is just the plumbing standard those assistants use to read outside data. The user never types "MCP" — they click **"Connect Claude"** and Miting hands them a one-line setup snippet to paste into their assistant once.

- Binary: `miting-mcp` (small sidecar, same repo, `rmcp` server API), **read-only** DB access.
- Tools it exposes: `search_meetings(query, date_range, starred)`, `get_meeting(id)` (metadata+participants), `get_transcript(id, diarized=true)`, `get_summary(id)`, `get_action_items(range)`, `list_templates()`.
- Setup UX: Integrations → **"Ask AI about your meetings"** block with example questions (above) + a copy-per-client button (Claude / ChatGPT / Cursor) that writes `claude mcp add miting -- miting-mcp --db <path>`.
- Safety: read-only; no tool mutates the DB in v1. One clear sentence in-UI: "Any assistant you connect can read all your meeting notes on this device."
- Marketing: own launch post (doc 12 §5).

## 7. Settings — Integrations hub

New Settings tab (replaces scattered Beta toggles). **A vertical list of rows, not a grid of cards** (user directive): each row = logo · name · one-line description · status dot · Connect/Manage button. Below the list: the "Ask AI about your meetings" block (§6) and a delivery-log viewer (last 50, filter by meeting).

**Connect flow (must work end-to-end):** each connector's **Connect** opens a small modal with its 2–3 real setup steps + the single field it needs (token / device-code / webhook URL) + **Test & save** (verifies before storing to keychain). Connected rows show account/target + Manage/Disconnect. Mockup: [mockups/integrations.html](mockups/integrations.html) (rows + working connect modals + the plain-language AI block).

## 8. Acceptance criteria

- [ ] Jira + Slack refactored onto the trait interface with zero UX change (07/08 criteria still pass).
- [ ] Tokens verifiably absent from SQLite (`SELECT * FROM settings` audit) and present in OS keychain.
- [ ] Delivery log populated by both connectors; badges render on meetings page.
- [ ] `miting-mcp` answers all six tools against a seeded DB from Claude Desktop; content stays local (no network I/O in the sidecar at all).
- [ ] Adding a toy connector (e.g. local-file "export sink") takes <1 day using only the trait + a settings card — the platform test.
