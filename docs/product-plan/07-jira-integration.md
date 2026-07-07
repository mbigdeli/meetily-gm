# 07 — Jira Integration (AI Task Push)

> Phase 2 · Effort: ~1.5 weeks · Covers user request #6 · Depends on: connector platform (doc 10), Prompt Studio LLM plumbing (doc 06)

---

## 1. Goal

From a finished meeting, Miting suggests which parts of the discussion are **tasks**, lets the user multi-select them, and — per task — opens a popup where the user and the connected LLM co-author the ticket. After explicit confirmation, Miting creates the issue(s) in the user's Jira and links them to the meeting.

User-specified flow (verbatim requirements honored):
1. Task-able fragments are **suggested in the UI** with a Jira icon.
2. Clicking the icon opens a **popup**: LLM proposes a personalized task prompt (auto on open, or on click).
3. User **edits/finalizes the prompt**; LLM responds with ticket details preview.
4. After **final confirmation**, the task is created in Jira.
5. **Multi-select** of several suggestions → batch flow.

## 2. Connection & auth (MCP-first, per user decision)

### 2.1 Primary: Atlassian Remote MCP server

- Endpoint: `https://mcp.atlassian.com/v1/mcp` (Streamable HTTP). Auth: **OAuth 2.1 with dynamic client registration** — the app registers itself as a client and opens the browser for an Atlassian consent screen. This is a "Sign in with Atlassian" UX: no API-token copy-paste, and it legitimately sidesteps Jira's classic 3LO no-PKCE desktop problem.
- Client: Rust **`rmcp`** SDK (official modelcontextprotocol/rust-sdk; has client transport + OAuth examples). Lives in `src-tauri/src/connectors/jira/mcp_client.rs`.
- Tools used (names as exposed by the Atlassian server): `getVisibleJiraProjects`, `getJiraProjectIssueTypesMetadata`, `createJiraIssue`, `getJiraIssue`, `lookupJiraAccountId`, `atlassianUserInfo`, `getAccessibleAtlassianResources` (cloudId discovery).
- Acts strictly within the signed-in user's permissions; tokens (access+refresh) stored in **OS keychain** (doc 10 §3), never SQLite.

### 2.2 Fallback: REST v3 with API token

For users who can't use OAuth (policy-restricted sites, offline-ish setups) — Settings offers "Connect with API token" (site URL + email + token from id.atlassian.com). Same downstream flow; transport differences:
- `POST /rest/api/3/issue` requires **ADF** description → hand-rolled markdown→ADF generator (~150 lines: paragraph, bulletList/orderedList, heading, strong/em, codeBlock, link). Keep node nesting valid (text only inside paragraph/heading) — invalid ADF returns opaque 400s.
- The MCP path accepts markdown and converts server-side (known upstream quirks — test with lists).
- Rate limits: API-token traffic is exempt from Atlassian's points quota; still honor `429 + Retry-After`.

### 2.3 Experimental: Codex-driven (documented, off by default)

Since Miting already shells to Codex CLI, a `mcp_servers` entry in the user's Codex config can let Codex file the ticket agentically. Non-deterministic; ships as a documented power-user recipe only, not a UI path.

## 3. Real payload shapes (captured live from Jira Cloud, 2026-07)

`getAccessibleAtlassianResources` → `[{id: "<cloudId-uuid>", url: "https://<site>.atlassian.net", scopes: ["read:jira-work","write:jira-work"]}]` — cloudId drives all subsequent calls.

`getVisibleJiraProjects(cloudId, action:"create")` → paginated envelope:

```jsonc
{ "total": 30, "isLast": false, "values": [ {
    "id": "10000", "key": "DB", "name": "DrBalcony",
    "projectTypeKey": "software", "style": "next-gen", "simplified": true,
    "issueTypes": [
      { "id": "10002", "name": "Task",  "subtask": false, "hierarchyLevel": 0,
        "description": "Tasks track small, distinct pieces of work." },
      { "id": "10001", "name": "Story", "subtask": false, "hierarchyLevel": 0 },
      { "id": "10003", "name": "Bug",   "subtask": false, "hierarchyLevel": 0 },
      { "id": "10004", "name": "Epic",  "subtask": false, "hierarchyLevel": 1 },
      { "id": "10005", "name": "Subtask","subtask": true, "hierarchyLevel": -1 } ] } ] }
```

Notes that shape the UI:
- Issue-type **ids differ per project** (classic vs team-managed) — never cache ids across projects.
- Filter pickers to `subtask == false && hierarchyLevel == 0` by default (Task/Story/Bug); Epics behind an "advanced" toggle.
- 30 projects on a real mid-size site → project picker needs search (`searchString` param exists) + MRU pinning.

Create call (REST fallback shape; MCP tool mirrors it):

```jsonc
POST /rest/api/3/issue
{ "fields": {
    "project":   { "id": "10000" },
    "issuetype": { "id": "10002" },
    "summary":   "Follow up with vendor on SSO timeline",
    "description": { "type": "doc", "version": 1, "content": [ /* ADF from markdown */ ] },
    "labels":    ["miting"],
    "assignee":  { "accountId": "..." },        // optional; GDPR: accountId only
    "duedate":   "2026-07-13"                    // optional
} }
→ 201 { "id": "10123", "key": "DB-457", "self": "https://<site>.atlassian.net/rest/api/3/issue/10123" }
```

## 4. AI task-suggestion pipeline

### 4.1 Extraction

After summary generation (or on demand "Find tasks"), run an extraction pass through the configured LLM provider (`llm_client.rs` generic call, doc 05 §2.1):

- Input: diarized transcript (or summary's action-items section when transcript exceeds budget).
- Output contract (strict JSON, lenient-parsed like diarize.rs): `[{title, evidence_quote, speaker, suggested_assignee_name?, due_hint?, confidence}]`, max 15.
- Stored in new table `meeting_task_suggestions (id, meeting_id, title, evidence_quote, speaker, status TEXT /* suggested|dismissed|pushed */, pushed_issue_key, created_at)` — suggestions survive restarts; dismissed ones don't reappear on re-run (dedup by normalized title).

### 4.2 UI — suggestions in meeting detail

- Summary view: "Suggested tasks (N)" section — each suggestion a card: checkbox (multi-select), title, evidence quote (collapsed), speaker chip, **Jira icon button**.
- Multi-select bar appears when ≥1 checked: "Create N Jira issues…" → opens the popup in **queue mode** (one task at a time, progress "2 of 5", skip button).
- Mockup: [mockups/meeting-detail.html](mockups/meeting-detail.html).

### 4.3 The popup (per task) — two-stage co-authoring

**Stage A — prompt.** Textarea pre-filled with the *personalized ticket prompt* (auto-generated on open):

> Write a Jira {issue_type} for project {project}. Context: meeting "{{meeting_title}}" on {{date}}. Task: {title}. Evidence: "{evidence_quote}" — {speaker}. Include: crisp summary line, description with context and acceptance criteria, suggested labels.

User edits freely ("Regenerate" re-drafts it). Project + issue-type pickers (from §3 metadata, MRU defaults) sit above the prompt.

**Stage B — preview.** "Generate ticket" sends the finalized prompt to the LLM → returns structured fields rendered as an editable form: Summary (input), Description (markdown editor, rendered), Labels (chips, `miting` default), Assignee (optional; `lookupJiraAccountId` search), Due date (optional). Nothing is sent to Jira yet.

**Confirm.** "Create in Jira" → create call → success state shows `DB-457` linked; failure shows Jira's error verbatim + back-to-preview. Suggestion row flips to `pushed` with issue key badge; delivery recorded in the connector delivery log (doc 10 §4).

## 5. Settings — Integrations → Jira

- Connect card: [Sign in with Atlassian] (MCP OAuth) · "or connect with API token" expander (site/email/token + Test connection).
- Connected state: site name, account email (`atlassianUserInfo`), default project + issue type, default labels, Disconnect (revokes + clears keychain).
- Diagnostics: last error, "Test connection" re-check.

## 6. Edge cases & errors

| Case | Handling |
|---|---|
| OAuth browser flow abandoned | popup timeout 5 min → cancel state, retry button |
| Refresh token expired/revoked | connector state → `needs_reauth`; suggestion push prompts re-sign-in, queue preserved |
| MCP server unavailable/tool schema changed | typed error → offer API-token fallback path; log tool-list diff for diagnostics |
| Required custom fields on target project (classic screens) | create fails with field errors → surface Jira's message + link "open create screen in browser" prefilled via `https://<site>/secure/CreateIssueDetails!init.jspa?...` escape hatch |
| 429 | exponential backoff w/ Retry-After, max 3; queue mode pauses |
| Persian text in summary/description | UTF-8 end-to-end; verified in ADF text nodes (plain strings) |
| Duplicate push (same suggestion twice) | guard on `pushed_issue_key`; "already created DB-457 — create anyway?" |

## 7. File-level change list

| File | Change |
|---|---|
| `src-tauri/src/connectors/jira/` (new: `mod.rs`, `mcp_client.rs`, `rest_client.rs`, `adf.rs`, `extract.rs`) | transport, ADF generator, extraction pass |
| `src-tauri/migrations/…_task_suggestions.sql` | table §4.1 |
| Commands | `api_jira_connect_oauth`, `api_jira_connect_token`, `api_jira_status`, `api_jira_projects`, `api_jira_issue_types`, `api_extract_tasks(meeting_id)`, `api_jira_draft_ticket(suggestion_id, prompt)`, `api_jira_create_issue(...)` |
| `frontend/src/components/Integrations/Jira/` (new) | settings card, suggestion cards, popup (queue mode) |
| deps | `rmcp`, `keyring` (via doc 10), reqwest already present |

## 8. Acceptance criteria

- [ ] OAuth connect end-to-end against a real site; token survives restart via keychain; disconnect revokes.
- [ ] API-token fallback creates an identical issue (ADF description renders headings/lists correctly in Jira).
- [ ] Extraction on a 45-min diarized meeting yields sensible ≤15 suggestions with quotes; dismissed ones stay dismissed after re-run.
- [ ] Full popup flow: draft → edit prompt → preview → confirm → issue exists; key badge shown; delivery logged.
- [ ] Queue mode: 5 selected → 5 issues (or skips), progress correct, one failure doesn't abort the rest.
- [ ] Farsi meeting → Farsi ticket description round-trips to Jira intact.
