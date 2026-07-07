# 14 — Claude Code CLI Provider (subscription-based, no API key)

> Phase 1 · Effort: ~1–1.5 days · Sibling of the Codex CLI provider · Rationale: don't churn Claude subscribers to ChatGPT

---

## 1. Goal

Users who pay for **Claude Pro/Max** (but not ChatGPT/Codex) get the same "free" summarization experience Codex users already have — driven by their existing Claude subscription, **no Anthropic API key, no per-token billing**. This is strictly for **the signed-in user's own use** (same posture as the Codex provider), not a shared/hosted credential.

Adds one provider variant, `ClaudeCodeCli`, that shells out to the local **`claude` CLI** in headless print mode — a near-exact mirror of the existing Codex integration.

## 2. Why this is the right analogue

| | Codex CLI (exists) | Claude Code CLI (new) |
|---|---|---|
| Auth | `codex login` → ChatGPT subscription | `claude` login → Claude Pro/Max subscription |
| Tokens owned by | CLI (`~/.codex/auth.json`) | CLI (`~/.claude/` / OS keychain) |
| Invocation | `codex exec --sandbox read-only -C <dir> -` (stdin prompt) | `claude -p "<prompt>"` (print/headless, prints answer + exits) |
| Cost to user | $0 beyond subscription | $0 beyond subscription |
| App stores keys? | No | No |

The design constraints that made Codex work apply almost verbatim — reuse them, don't reinvent (see §5).

## 3. Current state (verified)

- Provider enum: `frontend/src-tauri/src/summary/llm_client.rs:68` — `LLMProvider` incl. `CodexCli` (L77), string-parse `"codex" | "codex-cli"` (L91), dispatch to `crate::codex::generate_with_codex` at L155, display name L362.
- Codex module `frontend/src-tauri/src/codex/mod.rs` exposes the reusable shape: `resolve_codex_binary()`, `login_status()`, `read_account_info()`, `spawn_login_detached()`, `logout()`, `preflight()`, `exec_blocking()`, `generate_with_codex()`; env override `MEETILY_CODEX_EXE` (`CODEX_EXE_ENV`), `EXEC_TIMEOUT_SECS = 600`, `CREATE_NO_WINDOW` flag on Windows, Windows POSIX-shim guard (`where codex` lists the extensionless shim first — must be filtered).
- Settings: Codex sign-in currently lives in `BetaSettings.tsx`; post-redesign it moves under Summary providers (doc 13 §4.6).

## 4. Design

### 4.1 New module `frontend/src-tauri/src/claude_code/mod.rs`

Mirror `codex/mod.rs` one-to-one:

| Codex symbol | Claude Code equivalent |
|---|---|
| `CODEX_EXE_ENV = "MEETILY_CODEX_EXE"` | `CLAUDE_EXE_ENV = "MITING_CLAUDE_EXE"` (test override; see doc-wide test rule below) |
| `resolve_codex_binary()` | `resolve_claude_binary()` — locate `claude` on PATH + known install dirs |
| `login_status()` | `auth_status()` — see §4.3 (no exact 1:1 CLI command; probe strategy) |
| `read_account_info()` | best-effort account/email read |
| `spawn_login_detached()` | `spawn_login_detached()` — launch interactive `claude` login (opens browser) |
| `exec_blocking()` / `generate_with_codex()` | `run_blocking()` / `generate_with_claude_code()` |

### 4.2 Invocation

```
claude -p "<full prompt from Prompt Studio>" \
       --output-format text \
       --model <optional; default account model> \
       --allowedTools ""            # summarization is text-only — disable all tools/file access
```

- Prompt delivered via `-p` (or stdin if length warrants); response is the printed text.
- `--allowedTools ""` (or the equivalent restrictive permission flag) is the analogue of Codex's `--sandbox read-only`: this call must never touch the filesystem or run tools — it is a pure text completion. **Verify exact flag names against the installed `claude --help` during implementation** (Claude Code's CLI surface evolves; do not hard-code an unverified flag).
- Timeout 600 s, cancellation via `CancellationToken` killing the child — identical to Codex.

### 4.3 Auth detection (the one genuine difference)

Codex has a clean `codex login status` (exit 0 = signed in). Claude Code has no guaranteed identical command, so use a layered probe:
1. Check for the CLI (`resolve_claude_binary`).
2. Check credential presence (`~/.claude/` config / OS keychain entry) if stable, **else**
3. Fall back to a cheap capability probe: `claude -p "ping"` with a short (~15 s) timeout — exit 0 + non-empty output ⇒ authenticated; auth-error text ⇒ not signed in.

Surface the same three states the UI already understands: **not installed** / **not signed in** / **ready**. Reuse the Codex error taxonomy (`NotInstalled` / `NotLoggedIn` / `Timeout` / `Cancelled` / `NonZeroExit`).

### 4.4 Wiring into `llm_client.rs`

- Add `ClaudeCodeCli` to `LLMProvider` (L68 block).
- Parse `"claude-code" | "claude-cli"` (L89-91 block). **Do not** collide with the existing hosted `Claude` (Anthropic API) variant — these are two distinct providers: `Claude` = API key, `ClaudeCodeCli` = subscription CLI.
- Dispatch branch mirroring L155: `if provider == &LLMProvider::ClaudeCodeCli { return crate::claude_code::generate_with_claude_code(...) }`.
- Add to the no-HTTP grouping (L214) and display name (L362): `"Claude Code (subscription)"`.

### 4.5 Diarization reuse

Because doc 05 makes the diarization merge provider-agnostic (routes through the generic LLM call), `ClaudeCodeCli` automatically becomes usable for diarization too — no extra work.

## 5. Reuse these hard-won constraints (from the Codex work)

- **Windows spawn gotcha:** npm installs an extensionless POSIX shim next to `claude.cmd`; only spawn `.exe`/`.cmd`/`.bat` (error 193 otherwise). Port the Codex resolver's filter — do not reimplement naively.
- **Detached login:** the login flow opens a browser and outlives the short-lived call — spawn detached (Codex pattern), don't block on it.
- **Tests must never run the real CLI** (a stray logout logs the developer out). Mirror the Codex test rule: every Claude-Code-touching test sets the `MITING_CLAUDE_EXE` env override to a mock; guard the env with the same mutex helper.
- `CREATE_NO_WINDOW` on Windows so no console flashes.

## 6. Settings UX

Under Settings → Summary → provider list, add a **"Claude Code (subscription)"** card next to "Codex CLI", with parallel affordances: status pill (not installed / sign in / ready), **Sign in** button (launches `claude` login), account email when readable, "Recheck". Zero API-key field. Both subscription-CLI providers sit above the API-key providers so subscription users find the no-key path first.

## 7. Terms-of-use note (honest)

Anthropic's Claude Pro/Max subscriptions are oriented toward interactive use. Driving the CLI headlessly for the user's *own* meeting summaries is the same shape as the existing Codex usage and well within normal personal use, but: it may hit subscription rate/usage limits on heavy days, and Miting must **not** present it as "free Claude for everyone" or route multiple users through one login. Document this in-app (small helper text on the provider card) exactly as the Codex provider is framed: *"Uses your own Claude subscription on this device."*

## 8. File-level change list

| File | Change |
|---|---|
| `frontend/src-tauri/src/claude_code/mod.rs` (new) | full module mirroring `codex/mod.rs` |
| `frontend/src-tauri/src/summary/llm_client.rs` | enum variant, parse, dispatch, display name |
| `frontend/src-tauri/src/lib.rs` | register `claude_code` module + any `claude_code.*` Tauri commands (mirror `codex.*`: status/login_start/logout) |
| `frontend/src/components/SummaryModelSettings.tsx` (+ provider card) | Claude Code provider card |
| tests | mock-CLI tests via `MITING_CLAUDE_EXE`, arg-builder unit test |

## 9. Acceptance criteria

- [ ] With `claude` installed + signed in, selecting "Claude Code (subscription)" produces a summary with **no API key entered** and no API billing.
- [ ] Not-installed and not-signed-in states surface correctly; Sign-in button completes the browser login and flips to ready.
- [ ] Text-only enforced: the call performs no file/tool actions (verify with a prompt that would tempt tool use).
- [ ] Works as a diarization provider too (doc 05).
- [ ] Existing hosted `Claude` (API-key) provider still works and is not confused with `ClaudeCodeCli`.
- [ ] Tests never invoke the real `claude` binary.
- [ ] Farsi summary via Claude Code renders correctly (doc 03).
