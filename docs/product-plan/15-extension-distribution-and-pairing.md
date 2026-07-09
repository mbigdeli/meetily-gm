# 15 — Browser Companion: Self-Distribution & Automatic Pairing

> Phase 1 · Effort: ~3–4 days · Covers user requests: (a) install the extension from the desktop app, not the Chrome Web Store as the first step; (b) no API key / copy-paste to connect the extension to the desktop app — pair automatically.

---

## 1. Goals

1. **Install without the Web Store first.** The desktop app hands the user the extension and walks them through loading it into Chrome/Edge/Brave. (Web Store listing can come later as an *optional* convenience — not the required first step.)
2. **Zero-secret pairing.** The extension and desktop app recognise each other automatically. No API key, no base-URL typing, no copy-paste.

## 2. Current state (verified)

- Extension talks to the desktop app via a **Native Messaging host** `com.meetingcapture.host` and/or a localhost ingest server on **port 17380** (`extension/src/shared/types.ts`, `nativeHost.ts`, `localServiceClient.ts`).
- The options page has a "Meetily connection" section (`MeetilyConnectionSection.tsx`) exposing base URL / connection settings — this is the copy-paste friction the user wants gone.
- Extension is loaded unpacked today (dev mode); no Web Store dependency exists yet.

## 3. Distribution design (no Web Store required)

The desktop installer **bundles the built extension** (`extension/dist`) inside the app resources. A new **"Set up Google Meet companion"** flow (Integrations → Google Meet, and offered once in onboarding, doc 13 §4.7) does:

1. **Unpack** the bundled extension to a stable, user-readable path: `%LOCALAPPDATA%\Miting\companion-extension\` (writes on first run / update; versioned).
2. **Guide** the user through loading it (Chromium requires manual load for self-distributed MV3):
   - Button **"Open extensions page"** → launches `chrome://extensions` (and detects Edge/Brave, using `edge://`/`brave://`). Chromium blocks apps from opening these URLs directly in some versions → fallback: copy the URL + one-line instruction.
   - On-screen 3-step card with a looping GIF: (1) turn on **Developer mode**, (2) click **Load unpacked**, (3) pick the folder — with a **"Copy folder path"** button so step 3 is a paste.
3. **Auto-detect success:** once loaded, the extension pairs (see §4) and the desktop app flips the Google Meet row to **Connected** live — the user gets confirmation without doing anything else.

**Trade-offs (documented honestly in the flow + doc 12):**
- Chromium shows a *"Disable developer-mode extensions"* warning bubble on each browser start for unpacked extensions. Mitigation: (a) explain it in the setup card ("this is normal for locally-installed extensions; click Keep"), (b) offer a later, optional **Web Store / Edge Add-ons** listing whose only advantage is silencing that bubble and auto-updates. The Web Store path becomes a *convenience upgrade*, never the required first step.
- Enterprise-managed browsers may block unpacked extensions by policy → detect the failure and surface the Web Store fallback link.
- Updates: when the desktop app updates, it re-unpacks the new `dist`; MV3 unpacked reloads on browser restart. The pairing handshake carries a version so the app can warn if the loaded extension is stale.

## 4. Automatic pairing (no API key)

**Key realisation:** Native Messaging already pairs by identity, not by secret — so the "API key" can be removed entirely.

### 4.1 Native-messaging manifest names the extension

The desktop app installs the native-messaging host manifest (it already does for `com.meetingcapture.host`). That manifest's `allowed_origins` lists the **exact extension ID**. Chrome only lets *that* extension launch the host. This is the pairing:

- **Problem:** an unpacked extension's ID is derived from a key. If we don't pin it, the ID changes per machine and the manifest can't list it ahead of time.
- **Fix:** ship a fixed `"key"` field in the bundled `manifest.json` so the **extension ID is stable and identical on every install** (standard MV3 technique). The desktop app writes the native-messaging host manifest with that known ID at install time. Result: the two recognise each other with **zero user input** — no key, no URL.

### 4.2 Handshake

On load, the extension calls the native host `health.check` (existing action). The host replies with `{app_version, host_version, session_capable}`. The extension stores nothing secret; the connection *is* the native-messaging port, which Chrome authorises by the pinned ID. The desktop UI shows Connected.

For the localhost-ingest fallback path (used for audio framing on port 17380), replace any shared-key check with a **loopback-only + one-time auto-token**:
- Bind strictly to `127.0.0.1` (never `0.0.0.0`).
- On first native-messaging handshake, the host mints a random per-install token and pushes it to the extension **over the already-trusted native-messaging channel** (not shown to the user). The extension includes it on ingest POSTs. This authenticates the local socket without the user ever seeing a key, and prevents other local processes from posting to the ingest port.

### 4.3 Remove the manual connection UI

- Delete the base-URL / key fields from `MeetilyConnectionSection.tsx` (rename → `MitingConnectionSection`, doc 01). Replace with a read-only status: **Connected / Not connected**, host + extension versions, and a "Re-pair" button that just re-runs `health.check`.
- Port stays configurable only behind an "Advanced" disclosure for power users; default is automatic.

## 5. File-level change list

| File | Change |
|---|---|
| `extension/manifest.json` | add fixed `"key"` (stable ID); rename to Miting Companion (doc 01) |
| `extension/src/shared/localServiceClient.ts`, `nativeHost.ts`, `types.ts` | drop user-entered key/base-URL; use auto-token from handshake; loopback-only |
| `extension/src/options/sections/MitingConnectionSection.tsx` | replace connection form with auto status + Re-pair |
| Desktop: native-host installer (Rust install step) | write host manifest with the known extension ID; mint per-install ingest token; unpack `dist` to `%LOCALAPPDATA%\Miting\companion-extension\` |
| Desktop: new "Set up Google Meet companion" flow | `frontend/src/components/Integrations/GoogleMeet/` — open-extensions-page, copy-path, GIF steps, live connected detection |
| Ingest server (Rust) | bind 127.0.0.1 only; require auto-token; reject non-loopback |

## 6. Edge cases

- Extension ID pinned but user edits files → ID changes → host rejects; setup flow detects and offers re-unpack.
- Multiple Chromium browsers → install host manifest for each detected browser (registry entries per browser, as the retired project already did).
- Browser blocks `chrome://` navigation from the app → copy-URL fallback.
- Token leaked to a hostile local process → scope it per-install, rotate on re-pair, loopback-only limits blast radius; document that a fully-compromised local machine is out of threat model (local-first app).

## 7. Acceptance criteria

- [ ] Fresh machine: install desktop app → run companion setup → extension loaded and shows **Connected** with **no key or URL typed**.
- [ ] Captions/participants/audio flow to the desktop app immediately after pairing.
- [ ] Ingest port refuses posts without the auto-token and refuses non-loopback origins.
- [ ] Extension ID is identical across two machines (pinned key verified).
- [ ] Desktop update re-unpacks the extension; stale-version warning fires if the loaded copy is older.
- [ ] No Web Store account or listing is required to reach a working setup.
