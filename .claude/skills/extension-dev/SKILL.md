---
name: extension-dev
description: >
  Chrome MV3 companion-extension patterns for Miting — service-worker
  lifecycle, Google Meet DOM safety, the versioned host wire contract,
  auto-pairing (no API key), and Vitest unit patterns. Use when editing
  anything under extension/. Invoke with /extension-dev.
metadata:
  version: "1.0.0"
  sources:
    - https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
    - https://playwright.dev/docs/chrome-extensions
    - docs/product-plan/15-extension-distribution-and-pairing.md
---

# MV3 companion extension (Miting)

The extension captures Google Meet captions/participants/audio and sends them to
the desktop app. Also honor `extension/.cursor/rules/` (Meet DOM safety,
extension boundaries).

## Service-worker lifecycle (MV3)

- The SW **suspends after ~30s idle** and restarts on demand. **Never keep
  session state in SW memory** — persist to `chrome.storage` and rehydrate.
- Register every listener **synchronously at the top level** of the SW (not
  inside async callbacks) or events are missed after a restart.
- Long capture loops belong in the content script / offscreen document, not the
  SW.

## Google Meet DOM safety

- Meet's DOM is obfuscated and changes. Select by stable structural anchors
  (`div[role="region"][tabindex="0"]` for captions) with defensive fallbacks;
  never depend on generated class names.
- Debounce caption reads (~200ms) and poll participants on an interval
  (~45s) — see `content/capture/{caption-parser,participants,coordinator}.ts`.
- Detect Persian with `/[؀-ۿ]/` and set text direction accordingly.

## Host wire contract (keep parity)

- Envelope: `{ id, success, payload, error }`. Schema-first: validate with the
  Zod schemas in `src/shared/schemas.ts` before sending/acting.
- Ingest actions (`session.start/caption/participants/audio/end`,
  `health.check`) go to the local host; keep request shapes in
  `src/shared/ingestTypes.ts` the single source of truth.

## Auto-pairing (no API key — see doc 15)

- Ship a fixed `"key"` in `manifest.json` so the **extension ID is stable** on
  every install; the desktop app writes the native-messaging manifest with that
  known ID → pairing needs zero user input.
- The ingest socket binds `127.0.0.1` only and requires a per-install token that
  the host pushes over the trusted native-messaging channel. **No user-entered
  key or base URL** — the old connection form is removed.
- Never hardcode the extension ID in test/e2e code; read it from the SW URL.

## Testing

- Unit: **Vitest** (`vitest run`) + `happy-dom` for capture DOM tests; fake the
  `chrome` API (`@webext-core/fake-browser` or hand stubs). `npm run typecheck`
  (`tsc --noEmit`) must pass.
- E2E: **Playwright** `launchPersistentContext` with `channel:'chromium'` +
  `--load-extension` on the built `dist` — small smoke suite only (load, SW
  alive, options page, pairing handshake vs a stub host). See **testing-e2e**.

## Size

New `.ts` files stay ≤120 lines (`scripts/check-file-length.mjs`; tests exempt).
