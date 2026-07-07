# Miting — Master Product Plan

> **Status:** Approved planning document — no code in this package.
> **Author:** Mohamad Bigdeli · **Date:** 2026-07-06
> **Repo:** meetily-gm (to be rebranded **Miting**) · **Website:** https://miting.bigde.li

---

## 1. Vision

**Miting** is a free, open-source, local-first AI meeting assistant built for people who live in meetings — product managers, tech leads, and marketers. It records, transcribes, diarizes, and summarizes meetings entirely on the user's machine, then pushes the outcomes (tasks, decisions, summaries) into the tools where work actually happens: Jira, Slack, and beyond.

**One-line positioning:**

> *Free, local, private — with the integrations everyone else charges for.*

Every commercial competitor paywalls integrations (see §4). Miting's strategy is to give away exactly the layer they monetize, powered by the user's own accounts and keys (or their existing ChatGPT subscription via Codex CLI), with zero cloud backend.

### Product principles

1. **Local-first, always.** Audio, transcripts, and summaries never leave the machine unless the user explicitly pushes them somewhere. No Miting server ever sees meeting content.
2. **Bring your own intelligence.** Ollama, Codex CLI (ChatGPT subscription), Claude Code CLI (Claude Pro/Max subscription), hosted Claude/OpenAI/Groq/OpenRouter, or built-in llama — user's choice, user's keys or their existing subscription. Two zero-extra-cost subscription paths (Codex + Claude Code) mean no user is forced to switch AI vendors to use Miting.
3. **Meetings are objects, not logs.** A meeting has participants, decisions, action items, a priority, and a destination (Jira ticket, Slack channel) — not just a wall of text.
4. **Bilingual by design.** English and Persian (فارسی) are both first-class: transcription, RTL rendering, and summary output.
5. **Open source as a brand.** The repo, the docs, and the launch are the author's public portfolio. Quality of documentation is a feature.

---

## 2. Target personas

| Persona | Pain today | Miting answer |
|---|---|---|
| **Product manager** (primary) | Back-to-back meetings; action items evaporate; writing Jira tickets after calls is drudge work; note tools charge per seat | AI task suggestions → multi-select → Jira tickets in two clicks; prompt styles per meeting type; Slack recap to the team channel |
| **Tech lead** | Standups/syncs produce decisions nobody records; context lost between recurring meetings | Decision log, diarized "who said what", recurring-series linking, GitHub/Linear fast-follow connectors |
| **Digital marketer** | Client/customer calls full of quotes and requests that die in notes | Customer-call prompt style (pain points, quotes, feature asks), export to CSV/Notion, shareable summaries |
| **Persian-speaking professionals** (differentiator) | Almost no meeting tool handles Farsi transcription + RTL properly | Whisper fa support, RTL transcript & summary UI, Persian prompt templates |

---

## 3. What exists today (inherited + already built)

The fork already contains substantial work beyond upstream Meetily:

| Capability | Status | Where |
|---|---|---|
| Local recording + Whisper/Parakeet transcription | ✅ upstream | `frontend/src-tauri/src/audio/`, `whisper_engine/` |
| 8-provider LLM abstraction | ✅ upstream+fork | `frontend/src-tauri/src/summary/llm_client.rs` |
| **Codex CLI provider** (summaries on ChatGPT subscription, no API key) | ✅ **fork feature** | `frontend/src-tauri/src/codex/mod.rs` |
| **Claude Code CLI provider** (summaries on Claude Pro/Max subscription, no API key) | 🟡 planned — sibling of Codex | doc 14 |
| Google Meet companion extension (captions, participants, audio ingest) | ✅ **fork feature** | `extension/` → port 17380 |
| **AI diarization** (Whisper × Meet captions → named speakers) | ✅ **fork feature** | `frontend/src-tauri/src/gmeet_ingest/diarize.rs` |
| Participants capture | ✅ DB only, no UI | `meeting_participants` table |
| Summary templates (6 built-in JSON + custom dir) | ✅ beta-level | `frontend/src-tauri/templates/`, `BetaSettings.tsx` |
| Partial Persian (fa caption enum, RTL helpers) | 🟡 partial | `extension/src/shared/schemas.ts`, `helpers.ts` |
| Meeting list | 🟡 sidebar-only | `frontend/src/components/Sidebar/` |
| Analytics | ⚠️ upstream PostHog key — must be replaced | `analytics/commands.rs:12` |
| Updater | ⚠️ points at Zackriya releases — must be replaced | `tauri.conf.json` |

---

## 4. Competitive landscape (2026)

| Product | Price for integrations | Integrations | MCP | Local/private |
|---|---|---|---|---|
| Granola | **$14–35/u/mo** (all integrations Business+) | Notion, Slack, HubSpot, Zapier… | Yes (paywalled) | No (cloud) |
| Otter.ai | $8–30/u/mo | Slack, Notion, Jira, Salesforce… | Yes | No |
| Fireflies.ai | $10–29/u/mo | 50+ (leader) | Yes | No |
| Fathom | Free tier limited; $15–34 | HubSpot, Slack, Asana, Zapier | No | No |
| tl;dv | Native CRM at **$59/u/mo** | Zapier at Pro | No | Partial (desktop capture) |
| Krisp | ~$8+/u/mo | Thin | No | Partial |
| **Miting** | **$0, open source** | Slack, Jira (MCP-first), then Notion/Linear/GitHub… | **Yes — local, free** | **Yes — fully** |

**The attack line:** competitors monetize the integration layer; Miting open-sources it. The local MCP server (doc 10) additionally makes Miting the only meeting tool whose data Claude/ChatGPT can query for free, privately.

---

## 5. Roadmap

### Phase 0 — Identity (unblocks public repo; ~1 week)

*Everything needed before the repo can safely go public.*

| Work | Doc |
|---|---|
| Rebrand: name, identifiers, icons, UI strings, README/LICENSE | [01-rebrand-identity.md](01-rebrand-identity.md) |
| Strip upstream PostHog key → own PostHog project, keep opt-in consent | [02-analytics-and-updates.md](02-analytics-and-updates.md) |
| Updater → own GitHub releases + new signing key | [02-analytics-and-updates.md](02-analytics-and-updates.md) |
| Landing page shell at miting.bigde.li | [12-open-source-launch.md](12-open-source-launch.md) |

**Exit criteria:** `grep -ri "meetily\|zackriya"` returns only LICENSE attribution + fork notice; app updates from own repo; analytics ping own project; repo public.

### Phase 1 — PM core (~3–4 weeks)

| Work | Doc | Effort |
|---|---|---|
| App redesign foundation (nav, design tokens, meetings page) | [13-app-redesign.md](13-app-redesign.md), [09-meetings-page.md](09-meetings-page.md) | 1.5 w |
| Prompt Studio (meeting styles, editable prompts, `{{transcript}}` contract) | [06-prompt-studio.md](06-prompt-studio.md) | 1 w |
| Claude Code CLI provider (subscription Claude, no API key) | [14-claude-code-provider.md](14-claude-code-provider.md) | 1–1.5 d |
| Participants export | [04-participants-export.md](04-participants-export.md) | 2–3 d |
| Persian completion (whisper lang, RTL rendering, fa summaries) | [03-persian-language.md](03-persian-language.md) | 1 w |
| Diarization hardening (provider-agnostic, rename UI) | [05-diarization-hardening.md](05-diarization-hardening.md) | 3–4 d |

### Phase 2 — Integrations (~3 weeks)

| Work | Doc | Effort |
|---|---|---|
| Connector platform base (secrets, ActionItem model, delivery log) | [10-connector-platform.md](10-connector-platform.md) | 3–4 d |
| Slack: manifest bot + webhook fallback, Block Kit recaps | [08-slack-integration.md](08-slack-integration.md) | 3 d |
| Jira: MCP-first auth, AI task suggestions, multi-select create flow | [07-jira-integration.md](07-jira-integration.md) | 1.5 w |

### Phase 3 — Differentiators (ongoing)

| Work | Doc |
|---|---|
| Local MCP server (Claude/ChatGPT query your meetings) | [10-connector-platform.md](10-connector-platform.md) |
| Cross-meeting action tracker, decision log, weekly digest, ask-your-meetings | [11-feature-backlog.md](11-feature-backlog.md) |
| Fast-follow connectors: Notion, Linear, GitHub, Teams | [10-connector-platform.md](10-connector-platform.md) |

### Launch track (parallel with Phases 1–2)

See [12-open-source-launch.md](12-open-source-launch.md): README, landing page content, LinkedIn/Product Hunt/HN plan, Persian tech community outreach, personal-branding playbook.

---

## 6. Document map

| # | Document | Covers user request |
|---|---|---|
| 00 | This file | — |
| 01 | [Rebrand & identity](01-rebrand-identity.md) | #9 (name, links), #12 (naming) |
| 02 | [Analytics & updates](02-analytics-and-updates.md) | #9 (update server), #10 (own analytics) |
| 03 | [Persian language](03-persian-language.md) | #2 |
| 04 | [Participants export](04-participants-export.md) | #3 |
| 05 | [Diarization hardening](05-diarization-hardening.md) | #4 |
| 06 | [Prompt Studio](06-prompt-studio.md) | #5 |
| 07 | [Jira integration](07-jira-integration.md) | #6 |
| 08 | [Slack integration](08-slack-integration.md) | #7 |
| 09 | [Meetings page](09-meetings-page.md) | #8 |
| 10 | [Connector platform & local MCP](10-connector-platform.md) | #6/#7 foundation, differentiator |
| 11 | [Feature backlog](11-feature-backlog.md) | #11 |
| 12 | [Open-source launch & branding](12-open-source-launch.md) | publishing + self-branding goal |
| 13 | [App redesign (UX/UI)](13-app-redesign.md) | #8 + overall UX request |
| 14 | [Claude Code CLI provider](14-claude-code-provider.md) | subscription Claude summaries, no API key |
| — | [mockups/](mockups/) | visual reference for 09 & 13 |
| — | [index.html](index.html) | browsable overview |

Codex connection (#1) is already implemented; it is documented as a flagship feature in §3 and marketed in doc 12.

---

## 7. Non-goals (explicit)

- **No cloud backend.** No Miting-hosted transcription, storage, or relay. The landing page is static.
- **No bot-joins-your-call.** Capture stays on-device (audio + extension), unlike Otter/Fireflies bots.
- **No telemetry without consent.** Analytics stay opt-in with the existing consent UI.
- **No license change.** MIT, with upstream Zackriya attribution preserved (see doc 01 §6).
- **No mobile app** in this roadmap.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| "Miting" SEO collision with "meeting" typo traffic | Consistent tagline "Miting — AI meeting minutes"; own distinct domain (miting.bigde.li); never fight the autocorrect in copy (doc 01 §2) |
| Atlassian Remote MCP API surface changes | REST v3 API-token fallback is specified and kept working (doc 07 §5) |
| Upstream Meetily diverges | Fork notice + periodic cherry-pick policy (doc 12 §6) |
| Whisper Persian accuracy on small models | Recommend large-v3/medium for fa; document expectations (doc 03 §6) |
| Solo-maintainer bandwidth | Phases sized ≤4 weeks; each doc has explicit out-of-scope sections |
