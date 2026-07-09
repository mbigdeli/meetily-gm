# 16 — Making Miting AI-Native (Smart, Local-First, Provider-Agnostic)

> Strategy doc · feeds Phase 3+ and reshapes Phases 1–2 · Covers user request: "totally check and plan how we make the entire system more AI-based and smarter using the connected LLM (Codex, llama, Claude, …)."
>
> Built from a multi-agent ideation+adversarial-vetting pass (53 ideas across 6 capability lenses → 14 survived skeptical review). The vetting is the valuable part: it says *how* to build each so it stays honest on a small local model.

---

## 1. The thesis

Today Miting uses the LLM in exactly one place: a batch summary after the meeting. AI-native means the connected LLM becomes the spine of the product — extracting decisions and commitments with provenance, answering questions across every past meeting, tracking action items over time, shaping the summary to the meeting type, and (opt-in) assisting live. All of it **on the model the user already chose** (Codex, Claude Code, Ollama/llama, or a hosted key), all of it degrading gracefully offline.

## 2. Two hard constraints the design must respect (surfaced by adversarial vetting)

These killed or reshaped most naive ideas — treat them as law.

**A. The pipeline is batch and post-meeting.** Every LLM call today is a one-shot `codex exec`-style subprocess fired *after* the session ends; the native-messaging host is deliberately short-lived; there is **no live inference path** and no streaming. Therefore every "during-meeting" feature is **net-new plumbing** (a persistent local-model loop), not a small addition — and must be costed as such.

**B. "Degrades to a small local model" must be true by construction, not by hope.** An 8B (often really a 1–4B local) model is bad at exactly the judgment these features want. The winning pattern, repeated across every kept feature:

> **Make correctness a property of deterministic code; use the LLM for enrichment.** Retrieval, substring-anchoring of quotes, threshold/keyword triggers, and schema validation are model-independent. The LLM adds prose, nuance, and recall on top. When the model is small, the feature degrades to "reliable but plainer," never "confidently wrong."

Concretely this means: cite by *retrieval* not by trusting the model to attribute; derive a transcript timestamp by *matching the model's quote back to the transcript* (drop items whose quote isn't found — that is the real hallucination guard); auto-close a loop only on an explicit cue, else leave it for one-tap user resolve; keep a strict-JSON schema with an explicit `UNCERTAIN` escape so low-confidence calls surface for review instead of silently mutating data.

**Privacy corollary for live features:** streaming an in-progress transcript to a *hosted* provider every N seconds is continuous exfiltration. All live/periodic passes run on the **local model by default**; a hosted provider is used only for one-shot post-session work unless the user explicitly opts into live streaming, and a "sensitive meeting / offline" switch always wins.

## 3. Foundational enablers (build these first — they unblock the rest)

| Enabler | What | Unblocks | Effort |
|---|---|---|---|
| **F1 · Local embedding index** | Add `sqlite-vec` (bundle the Windows DLL, enable rusqlite `load_extension`); bump `SCHEMA_VERSION`; embed transcript chunks at pipeline finalize with a one-time backfill. **Pin a genuinely multilingual embedder** (bge-m3 / multilingual-e5) behind an `EmbeddingProvider` trait — a generic English model silently kills Persian recall. | RAG chat, semantic search, decision log, continuity digest, auto-tagging | L |
| **F2 · Model tiering & routing** | A capability flag per feature (`min_tier: local/mid/frontier`) + a router: cheap/live/classification passes → local model; hard synthesis → the user's frontier provider if configured. Two-pass tiered merge (local draft per chunk → one frontier stitch) for long meetings. | Everything; cost/latency control | M |
| **F3 · Structured-output reliability** | Generalise the existing merge strict-JSON + repair loop into a reusable `generate_json(schema, …)` across all providers, with the `UNCERTAIN` escape convention and deterministic post-validation (quote-anchoring). | Every extraction feature | M |
| **F4 · Live-inference loop** (only if pursuing live features) | A persistent local model kept warm during recording, fed the rolling caption/partial-Whisper window; local-only by default. | All §5 live features | L |

F1–F3 are the backbone of an AI-native Miting and should land early in Phase 3 (F3 partly exists). F4 is optional and gates the whole "live" category.

## 4. Vetted feature catalog (survived adversarial review)

Impact 1–5, effort S/M/L, tier = minimum model that makes it *good*. "Local floor" = what the feature degrades to on a small local model.

### 4.1 Cross-meeting knowledge & memory (highest strategic value)

| Feature | What | Tier | I/E | The build that keeps it honest |
|---|---|---|---|---|
| **Ask-Your-Meetings (RAG chat)** | Natural-language Q&A over all meetings, cited to meeting+timestamp+speaker; Persian and English. | mid | 4 / L | Retrieval = F1 hybrid (vector + FTS5). **Local floor:** return the retrieved chunks *quoted verbatim with citations* (citation accuracy is a property of retrieval, not the model); only the frontier tier free-synthesises prose. |
| **Semantic search across meetings** | Fuzzy concept search ("the churn conversation") even when words don't match, cross-lingual. | small-local | 4 / L | Pure retrieval, **needs no LLM to work**. Must pin a *multilingual* embedder or Persian↔English recall silently dies; add a mixed-language recall eval to CI. LLM only adds an optional "why this matched" line + query expansion. |
| **Living Decision Log** | Auto-maintained, deduped log of every decision, with who/when and a reversal chain (which later meeting amended it). | small-local (frontier for reversals) | 4 / L | New `decisions` table with `supersedes_id` self-FK + embedding. LLM classifies NEW/DUPLICATE/SUPERSEDES/REVERSES with a mandatory `UNCERTAIN` escape → low-confidence calls go to user review, never silently drop a decision. |
| **Cross-Meeting Continuity Digest** | For a recurring series, "what changed since last time": items closed, slipped, decisions reversed, momentum. | mid | 3 / L | Needs a stable `series_id` (from meeting code, else title+participants hash) and an extracted item store first. **Local floor:** show only low-risk `still_open` carryover; hide closed/reversed claims below frontier tier (a wrong "decision reversed" destroys trust). |

### 4.2 Post-meeting intelligence

| Feature | What | Tier | I/E | The build that keeps it honest |
|---|---|---|---|---|
| **Decision & Commitment Extractor (with provenance)** | Every decision + every "I'll do X by Friday", stamped with speaker and a jump-to-transcript timestamp. | mid | 4 / M | LLM returns `{type, statement, owner_hint, due_hint, quote}` only. **Rust derives the timestamp by substring-matching `quote` to the transcript and drops any item whose quote isn't found** — the real hallucination guard. Owner degrades to "Unknown/editable" on captionless/audio-only meetings (attribution is caption-overlap, not neural diarization). |
| **Auto-Type Classifier → Template Router** | On finish, detect meeting type (standup / discovery / planning / 1:1 / sales / incident / roadmap) and auto-pick the matching template. | small-local | 3 / L | **Fold into the existing merge call** (add `meeting_type/confidence/evidence` to the merge schema — zero extra round-trip). A cheap keyword+duration+participant-count pre-classifier picks the provisional template before merge; low confidence keeps the generic one and flags it. Prereq: build the shaped templates (doc 06). |
| **Summary Self-Critic (QA gate)** | After summarising, audit the summary against the transcript: unsupported claims, orphan action items (no owner/date), mangled names. | mid (lint: none) | 3 / L | **Split in two.** 5b-lint = pure-Rust deterministic linter (orphan actions, names absent from roster) — always on, local-first. 5b-critic = *optional, advisory, display-only* LLM audit; suppress faithfulness scores below mid tier (an 8B judge score is noise); auto-regenerate defaults OFF (a bad small-judge score can replace a good summary). |
| **Smart Auto-Title + slug** | Replace "Meet 2026-07-06" with "Checkout redesign: cut guest-flow, ship A/B by Aug". | small-local | 3 / S | Add `title`/`one_line_gist` to the merge schema; write the DB title, fall back to date on failure. **Do NOT rename the on-disk folder** (handle-in-use migration risk) — keep the smart title in DB + library UI only. |
| **Follow-up Email Drafter** | Ready-to-send drafts per audience (Exec / Team / Client), saved as `.eml`/`.md`; nothing sent automatically. | mid | 3 / M | **Descope the "infer recipient from participant domains"** idea — that data doesn't exist. User picks a tone/audience preset; generate variants from the summary into `final/emails/`. Warn that tone variants read alike on a small model. |
| **Output Router** | Proposes where each artifact goes (actions→Jira, recap→right Slack channel, notes→Confluence) as a reviewable checklist. | mid | 3 / L | The hard part is a **local identity directory** (display-name → per-connector IDs) that doesn't exist — Meet gives only display names. Build it, populate lazily on first confirmed route; any unmapped owner/topic = "UNROUTED, user picks", never an LLM guess; confirmation mandatory for DMs and non-mapped channels. |

### 4.3 Live / during-meeting (all gated on F4; local-only by default)

| Feature | What | Tier | I/E | The build that keeps it honest |
|---|---|---|---|---|
| **Live Template Runner** | Mid-meeting, run any template ("catch up the exec who just joined", "draft the decision so far") against the live transcript. | small-local | 4 / M | Reuses the template system (auto provider-agnostic). Needs a free-prompt path (not the sectioned report) + a visible generating/cancel state (no streaming; cold-start latency). Cap the window to ~1–2k tokens for small local models. |
| **Decision & Open-Loop Ledger** | Live two-column "settled vs still open" that updates as the conversation moves. | mid | 3 / L | Stateful diff (prior ledger + delta → new ledger) persisted as versioned JSON per session. **Local floor:** append-only, never auto-close a loop implicitly — one-tap user resolve + high-precision explicit-cue auto-close. Live passes run on the local model. |
| **Live Agenda Radar** | Paste an agenda; a sidebar shows the current item, ticks covered points, flags time risk. | small-local (LLM optional) | 3 / L | **Do not put an LLM on the 15–30s loop.** The tight loop is a local embedding matcher (embed agenda items + rolling window, cosine + dwell-time with hysteresis). LLM is sparse optional enrichment (resolved-vs-mentioned) once per item transition. Ship a "local-only, no AI" default. |
| **Talk-Time Meter (+ optional nudge)** | Live meter of who's dominating / who's silent; optional tactful private nudge to the host. | small-local (meter: none) | 3 / L | **Ship as two independent toggles.** Meter = pure math (default). Nudge = opt-in, OFF by default; on small models runs in deterministic-guard mode (hard threshold + fixed sentence, rate-limited); hard-gated to local models unless the user consents to live hosted streaming. Note: a *live* per-speaker source is net-new (today attribution is post-meeting). |

### 4.4 Persona-specific (thin layers on the extraction spine)

Vetting ran out of session budget before scoring these individually, but they are straightforward specialisations of §4.1–4.2 and carry low incremental risk once the spine exists:

- **PM** — PRD/spec seed (problem/goals/non-goals/open-questions/metrics) from a discovery meeting; roadmap-signal miner across meetings.
- **Tech lead** — Decisions/Risks/Blockers shaped template; Standup Diff (what changed since yesterday's standup — a specialisation of the continuity digest).
- **Marketer** — Customer pain-points + verbatim quotes with speaker/timestamp; competitive-mention radar; call sentiment/momentum. (Sentiment stays advisory — small models are weak at it.)

Each is a template (doc 06) + optionally an extra structured extraction pass; effort S–M each once F1/F3 exist.

## 5. Cut or deferred (with the reason — so we don't re-propose them)

| Idea | Why cut/deferred |
|---|---|
| **On-Deck Question Suggester** (live "incisive questions") | Value *is* insight quality → inverts the degrade-to-local rule; a small model produces bland/wrong prompts. Only viable frontier-live, which breaks privacy + latency. |
| **Live Bilingual Caption Translation** | Real-time per-segment translation is architecturally incompatible with the batch cold-start LLM path and fails the local bar. Revisit only with a dedicated local MT model, not the summary LLM. |
| **Fully-autonomous agents** (auto-file tickets / auto-send email / auto-schedule without approval) | Kept only in **human-in-the-loop** form (propose → user confirms). No outbound action without explicit confirmation — trust is the brand (doc 11 rejects). |
| **Auto-rename on-disk session folders** | Handle-in-use + path-rewrite migration risk; smart title stays in DB/UI only. |

## 6. Phased rollout

- **Spine (early Phase 3):** F3 generalised structured output → Decision & Commitment Extractor (provenance) → Auto-Title → Auto-Type→Template router. These upgrade the *existing* post-meeting flow with no new infra.
- **Memory (mid Phase 3):** F1 embedding index → Semantic Search → Ask-Your-Meetings RAG → Living Decision Log → Continuity Digest. This is the differentiator tier (competitors gate it behind paid plans).
- **Assist & route (late Phase 3):** Summary Self-Critic, Follow-up Email Drafter, Output Router, persona templates.
- **Live (optional, own track):** F4 loop → Live Template Runner → Open-Loop Ledger → Agenda Radar → Talk-Time meter. Only if the local-inference loop proves fast enough; every item local-first.

## 7. Provider strategy (how "Codex, llama, Claude…" all stay first-class)

- Everything routes through the existing `LLMProvider` abstraction + the new `generate_json`/`generate_text` and `EmbeddingProvider` traits — **no feature hard-depends on one vendor.**
- **Tiering, not vendor lock:** each feature declares its `min_tier`; the router uses the user's local model for cheap/live/classification passes and their configured frontier provider (Codex/Claude Code/Claude/OpenAI) for hard synthesis. A user fully offline on Ollama gets every feature at its local floor.
- **Codex/Claude Code subscription paths** (docs 07/14) make the frontier tier *free* for users who have those subscriptions — a structural cost advantage no cloud competitor can match.
- **Embeddings are always local** (F1) — the memory layer never needs a network call, keeping the privacy promise even for RAG.

## 8. Acceptance criteria (for the strategy, not one feature)

- [ ] A user on Ollama-only (offline) can use every shipped AI feature at its documented local floor — nothing hard-requires a frontier model or a network call.
- [ ] Every extraction feature validates the model's output deterministically (quote-anchoring / schema / `UNCERTAIN` escape) before it touches stored data.
- [ ] No live/periodic pass sends transcript to a hosted provider without explicit opt-in; "sensitive/offline" switch overrides everything.
- [ ] The embedding index is multilingual (Persian recall verified by a CI eval set).
- [ ] No feature performs an outbound action (ticket/email/message) without explicit user confirmation.
