# 12 — Open-Source Publishing, Launch & Personal Branding

> Launch track (parallel to Phases 1–2) · Covers publishing goal + "leverage it as my branding thing"

---

## 1. Publishing checklist (gate: end of Phase 0)

- [ ] Rebrand complete (doc 01) — grep gate passes.
- [ ] Analytics/updater swapped (doc 02) — no upstream endpoints in build.
- [ ] Repo renamed `miting`, description/topics set (doc 01 §3).
- [ ] Community files: `README.md` (§2), `CONTRIBUTING.md` (refreshed), `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md` (private disclosure email), issue templates (bug/feature/question) + PR template.
- [ ] `LICENSE.md` dual attribution intact (MIT obligation).
- [ ] CI green on public runners; release `v0.5.0` published with signed Windows installer + `latest.json`.
- [ ] Landing page live at **miting.bigde.li** (§4).
- [ ] GitHub Discussions on (Q&A, Ideas, Show-and-tell).

## 2. README outline (the #1 branding asset)

1. Logo + **"Miting — AI meeting minutes. Local, private, free."** + badges (release, license, downloads, CI).
2. 30-second pitch + hero GIF (re-captured post-redesign): record → diarized transcript → summary → push to Jira/Slack.
3. **Why Miting** table vs Granola/Otter/Fireflies: price, local-first, integrations-free, Persian, MCP.
4. Feature list w/ screenshots (meetings library, Prompt Studio, Jira flow, Slack recap, فارسی transcript RTL).
5. Install (Windows first; macOS/Linux as they ship) + Google Meet companion setup.
6. AI providers (Codex CLI = "use your ChatGPT subscription, no API key", Ollama for fully offline, keys for the rest).
7. Privacy model (one paragraph + link).
8. Roadmap link → `docs/product-plan/index.html` (this package — public planning is itself a branding move).
9. Credits: fork of Meetily (Zackriya Solutions) — honest, prominent-enough.
10. **Author card:** "Built by Mohamad Bigdeli — PM. → miting.bigde.li · LinkedIn · more tools."

## 3. Versioning & upstream policy

- SemVer from `v0.5.0`; `v1.0.0` = end of Phase 2 (integrations shipped).
- Hard fork: no tracking upstream `main`. Quarterly review of upstream fixes; cherry-pick security/audio fixes only, note in CHANGELOG ("includes upstream fix X").
- CHANGELOG.md kept from v0.5.0 (Keep-a-Changelog format) — release notes copy-paste from it.

## 4. Landing page — miting.bigde.li

Static site (GitHub Pages, `CNAME miting.bigde.li`; DNS: CNAME record `miting` → `<user>.github.io`). Astro or plain HTML — no backend, no cookies (privacy story extends to the site; analytics via self-hosted-free GoatCounter or none).

Sections: hero (tagline + download button + GIF) · "your meetings never leave your machine" privacy block · feature trio (transcribe+diarize / summarize your way / push to Jira & Slack) · فارسی section **in Persian** (SEO for Persian queries — zero competition there) · comparison table · FAQ (models, Codex, offline) · footer (GitHub, author, privacy page `/privacy` per doc 02).

`/docs/slack` setup guide (doc 08 §3) and `/privacy` are part of the same site.

## 5. Launch sequence

| When | Action |
|---|---|
| Phase 0 done | **Soft launch:** repo public, no promotion. 1–2 weeks of issue-hardening with friendly testers |
| Phase 1 done | **LinkedIn launch post** (primary channel for PM personal brand): the "I built this" story — PM automates own meeting pain; GIF; comparison table. Persian version cross-posted to Virgool + Persian tech Twitter/X |
| +1 week | **Product Hunt** (Tuesday–Thursday); assets: 5 screenshots, GIF, first-comment tells the local-first story |
| same week | **Hacker News "Show HN"** — title formula: "Show HN: Miting – local-first AI meeting minutes (Whisper + your own LLM), free Jira/Slack push". HN loves local-first + no-cloud; be present in comments all day |
| Phase 2 done | Second wave: r/ProductManagement, r/selfhosted, r/LocalLLaMA (Ollama angle); MCP-server launch post when doc 10 §6 ships ("competitors charge $14/mo for this") |
| ongoing | Each shipped feature = LinkedIn build-in-public post (§6) |

## 6. Personal-branding playbook (the actual goal)

**Positioning statement:** *Mohamad Bigdeli — product manager who ships. Built Miting, an open-source AI meeting assistant used by PMs who are tired of paying per-seat for their own meeting notes.*

Mechanics:
1. **Build-in-public cadence:** 1 LinkedIn post/week from this docs package (each doc = 2–3 posts: problem → decision → result). The planning docs are content — publish the thinking, not just the code.
2. **Name attribution everywhere:** About dialog author card (doc 01 §5), README author card, landing footer, `--version` output, release notes signature.
3. **The Persian wedge:** only meeting tool with first-class فارسی → own that niche completely (Persian landing section, Persian demo video, Virgool article). Small pond, total ownership, international visibility among Iranian tech diaspora.
4. **Template gallery as community engine** (doc 11 #10): every community PR is an interaction with *your* project; monthly "style of the month" post.
5. **Talks/writing pipeline:** local-first AI meetup talk, "how I replaced my $19/mo note tool" blog post, MCP-server technical writeup (dev audience). Repurpose each into all channels.
6. **Signature line** for all of it: "Free and open source — because your meetings are yours."

KPIs (checked monthly in own PostHog + GitHub): stars, installer downloads from releases, LinkedIn follower delta, template-gallery PRs, Persian-page visits.

## 7. Support posture (solo maintainer, sustainable)

- Issues triaged weekly, honest SLA in README ("solo maintainer, best effort").
- Discussions for Q&A — answers become FAQ entries.
- "good first issue" labels from day one (extension i18n strings, template contributions).
- No Discord until >~500 stars (community fragmentation costs more than it gives early).
