---
name: testing-e2e
description: >
  Miting's four-layer test strategy and how to run/write each — Vitest+mockIPC
  (frontend), cargo test + pipeline CLI smoke (backend), Playwright (extension),
  WebdriverIO+@wdio/tauri-service (desktop smoke). Use when adding tests or
  wiring CI, and to decide WHICH layer a test belongs in. Invoke with /testing-e2e.
metadata:
  version: "1.0.0"
  sources:
    - https://v2.tauri.app/develop/tests/webdriver/
    - https://v2.tauri.app/develop/tests/mocking/
    - https://playwright.dev/docs/chrome-extensions
    - https://www.npmjs.com/package/@wdio/tauri-service
---

# Testing & E2E (Miting)

Every milestone PR must add/extend tests in the layer it touches. Per-PR suites
stay <5 min; the desktop smoke suite gates the beta release, not each PR.

## Which layer? (decision rule)

| If you're testing… | Use | Runs |
|---|---|---|
| React component logic, an `invoke()` contract | **Vitest + `@tauri-apps/api/mocks`** | every PR |
| Rust logic, a service, the summary/diarization pipeline | **`cargo test` + CLI smoke** | every PR |
| Extension SW / content-script / options flow | **Playwright** persistent context | every PR |
| The whole desktop app launching & critical path | **WebdriverIO + @wdio/tauri-service** | nightly + pre-release |

Push coverage DOWN the table (cheaper, more stable). Reserve the desktop
WebDriver layer for 3–5 irreplaceable end-to-end paths.

## Frontend: Vitest + mockIPC

```ts
import { mockIPC } from "@tauri-apps/api/mocks";
mockIPC((cmd, args) => {
  if (cmd === "api_get_meetings_library") return fixtureMeetings;
});
// mockIPC({ shouldMockEvents: true }) also fakes listen/emit.
```
Fast, headless, any OS. Caveat: never exercises real Rust/IPC — pair with a
backend test for the same command's contract.

## Backend: cargo test + pipeline smoke

- Unit/integration tests inline (`#[cfg(test)] mod tests`) — 210 exist today.
- **Pipeline smoke**: feed a fixture session (SQLite + transcript) to the
  summary/diarization path with a **mocked LLM exe** via the env-override
  (`MEETILY_CODEX_EXE` / `MITING_CLAUDE_EXE`) and assert the artifacts. Never
  call a real CLI in tests.

## Extension: Playwright

```ts
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",          // "new headless" — works in CI
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const [sw] = ctx.serviceWorkers();
const extId = sw.url().split("/")[2];   // never hardcode
```
Extensions need a **persistent context** + Playwright's bundled Chromium. SWs
suspend after ~30s → wrap long `evaluate()` in a "Service worker restarted"
retry. Keep the suite tiny (no in-worker parallelism).

## Desktop smoke: WebdriverIO + @wdio/tauri-service

- The current official path. Embedded WebDriver provider (no external binary);
  on Windows set `autoDownloadEdgeDriver: true` so msedgedriver auto-matches the
  bundled WebView2 — a version mismatch shows up as a **silent hang**, the #1
  Windows failure signature.
- `tauri-plugin-wdio` adds `browser.tauri.execute()` + IPC command mocking.
- Service is pre-1.0 → pin versions, keep suite to launch / record→transcript /
  settings-persist. CI: `windows-latest`; Linux needs `webkit2gtk-driver` +
  `xvfb-run`.
- Documented fallback if it destabilizes: Playwright `connectOverCDP` into
  WebView2 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`),
  Windows-only.

## CI wiring

See `.github/workflows/ci.yml`: rust (win), extension (ubuntu), frontend
(ubuntu), conventions. Desktop smoke lives in a separate nightly/pre-release
workflow (build cost), not the per-PR gate.
