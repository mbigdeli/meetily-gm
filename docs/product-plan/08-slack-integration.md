# 08 — Slack Integration (Meeting Recaps)

> Phase 2 · Effort: ~3 days · Covers user request #7 · Depends on: connector platform (doc 10)

---

## 1. Goal

One click sends a formatted meeting recap (summary, decisions, action items) to a Slack channel the user picks. Secondary: send individual summary sections or task lists as follow-ups in a thread.

## 2. Why not "Slack MCP" for posting (research verdict)

Slack's MCP server + Real-time Search API (GA 2026-02) is **read/search-oriented** — built for agents pulling Slack context, not for simple message posting. A public OAuth Slack app would require a hosted redirect service + client secret — violates Miting's no-backend principle. Therefore:

- **Primary: user-owned Slack app from a shipped manifest → bot token (`xoxb-…`) + Web API.** Slack explicitly designed manifests for this share-and-instantiate pattern. ~3-minute setup, full capability (channel picker, threads, updates, Block Kit).
- **Fallback: Incoming Webhook URL** — zero-thought setup, but locked to one channel, post-only, no threads. Offered as "Quick setup".
- **MCP-watch note:** if Slack's MCP server gains a post/write tool, add it as a transport behind the same connector interface (doc 10) — UI unchanged.

## 3. Setup UX (Settings → Integrations → Slack)

### 3.1 Full setup (bot token)

Wizard with copy-paste manifest (shipped in-app + docs):

```yaml
display_information:
  name: Miting
  description: Meeting recaps from Miting — local, private AI meeting minutes
  background_color: "#1a1d29"
features:
  bot_user:
    display_name: Miting
    always_online: false
oauth_config:
  scopes:
    bot: [chat:write, chat:write.public, channels:read]
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
```

Steps rendered in the wizard: 1) api.slack.com/apps → "Create New App" → "From a manifest" → paste → create. 2) "Install to Workspace" → allow. 3) Copy **Bot User OAuth Token** → paste into Miting → **Test** (calls `auth.test`, shows workspace name). Token → OS keychain.

`chat:write.public` lets the bot post to any public channel without being invited; private channels require inviting `@Miting` (documented in wizard).

### 3.2 Quick setup (webhook)

Paste webhook URL → Test (posts "Miting connected ✅"). Stored in keychain. Limitations banner shown (single channel, no threads).

## 4. Send-to-Slack UX

- Meeting detail header: **"Send to Slack"** button → popover: channel picker (bot mode: `conversations.list` public channels + search + MRU; webhook mode: fixed label), content checkboxes (Summary ✓ / Decisions ✓ / Action items ✓ / Participants ☐ / link note), preview pane rendering the Block Kit output, **Send**.
- Post-send: "Sent to #product-sync" + permalink (`chat.postMessage` response `ts` → `chat.getPermalink`); delivery logged (doc 10 §4). Re-send warns "already sent to #product-sync at 14:02".
- Per-section send: AISummary section menus gain "Send to Slack" (single-section message; bot mode offers "reply in thread of the recap" when a recap `ts` exists).

## 5. Message template (Block Kit)

Constraints honored: ≤50 blocks, section text ≤3000 chars, top-level `text` fallback set.

```jsonc
[
 { "type":"header",  "text":{"type":"plain_text","text":"📋 {meeting_title} — {date}"} },
 { "type":"context", "elements":[{"type":"mrkdwn",
     "text":"{duration} min · {n} participants · recorded with <https://miting.bigde.li|Miting>"}] },
 { "type":"section", "text":{"type":"mrkdwn","text":"*Summary*\n{2-3 sentence overview}"} },
 { "type":"section", "fields":[
     {"type":"mrkdwn","text":"*Decisions*\n• …"},
     {"type":"mrkdwn","text":"*Risks*\n• …"} ] },
 { "type":"divider" },
 { "type":"section", "text":{"type":"mrkdwn","text":"*Action items*\n• {owner}: {task} — *{due}*\n• …"} }
]
```

- Markdown→mrkdwn converter needed (Slack mrkdwn ≠ markdown: `*bold*`, `_italic_`, no headings — headings become bold lines). Lives in `connectors/slack/mrkdwn.rs`; unit-tested against the summary renderer's output.
- Overflow: content >~12k chars → truncate sections with "… full notes in Miting" tail. (File upload needs `files:write` — deliberately out of scope v1 to keep scopes minimal.)
- Jira badges: pushed tasks (doc 07) render as `<https://site/browse/DB-457|DB-457>` links in action items — recap becomes the team-facing index of the meeting.
- Persian: Slack renders RTL text fine; keep section order identical, content in Farsi as-is.

## 6. Rate limits & errors

- `chat.postMessage` ~1 msg/s/channel — irrelevant for this use; still handle `429 retry_after`.
- Token revoked/app removed → `invalid_auth` → connector `needs_reauth` state, wizard reopens.
- `channel_not_found`/`not_in_channel` (private) → actionable message: "Invite @Miting to this channel or pick a public one."
- Webhook 404 (deleted) → prompt re-setup.

## 7. File-level change list

| File | Change |
|---|---|
| `src-tauri/src/connectors/slack/` (new: `mod.rs`, `client.rs`, `blocks.rs`, `mrkdwn.rs`) | Web API client (reqwest), Block Kit builder, converter |
| Commands | `api_slack_connect_token`, `api_slack_connect_webhook`, `api_slack_status`, `api_slack_channels`, `api_slack_send(meeting_id, channel, parts)`, `api_slack_send_section(...)` |
| `frontend/src/components/Integrations/Slack/` (new) | wizard, send popover, preview |
| Docs/site | manifest YAML + setup guide page (`miting.bigde.li/docs/slack`) |

## 8. Acceptance criteria

- [ ] Manifest wizard → working bot in a fresh workspace in <5 min by a non-developer (usability-test once).
- [ ] Recap renders correctly in Slack (desktop+mobile): header, fields, action items, permalink returned.
- [ ] Webhook mode posts same content minus threading; limitations banner shown.
- [ ] Farsi recap renders RTL-correct in Slack.
- [ ] Revoked token → needs_reauth flow; private channel error → actionable hint.
- [ ] Delivery log records channel, ts, timestamp; duplicate-send warning works.
