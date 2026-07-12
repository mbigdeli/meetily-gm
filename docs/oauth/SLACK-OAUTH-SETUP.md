# One-click Slack ("Connect with Slack") — one-time setup

Miting uses Slack's **PKCE** flow, so there is **no client secret** and **no
backend**. You register a tiny Slack app once and host one static file; after
that, connecting is just *Connect with Slack → Allow*.

You need: a Slack account, and this repo on GitHub (`mbigdeli/meetily-gm`).

## Step 1 — Host the callback page (GitHub Pages, 2 clicks)

The redirect page is already in the repo at
[`docs/oauth/slack-callback.html`](./slack-callback.html) — it holds no secret.

1. GitHub → your `meetily-gm` repo → **Settings → Pages**.
2. **Build and deployment → Source: Deploy from a branch**. Branch: `main`,
   folder: **`/docs`**. Save.
3. Wait ~1 min, then confirm this URL loads (it will say "Missing authorization
   code" — that's correct, it means the page is live):
   ```
   https://mbigdeli.github.io/meetily-gm/oauth/slack-callback.html
   ```
   > Different username/repo? Update `redirect_urls` in the manifest (Step 2)
   > and the Callback URL in Miting to match your Pages URL.

## Step 2 — Create the Slack app from the manifest (~1 min)

1. Go to **https://api.slack.com/apps** → **Create New App** → **From a manifest**.
2. Pick your workspace.
3. Paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json)
   (choose the JSON tab). Create.
4. In the new app: **OAuth & Permissions → Advanced token security → enable
   PKCE** (so no secret is required).
5. **Basic Information → App Credentials → copy the `Client ID`** (public — safe
   to paste into Miting). You do **not** need the Client Secret.

## Step 3 — Connect in Miting

1. Settings → Integrations → Slack → **Connect with Slack**.
2. Paste the **Client ID**. The Callback URL is prefilled to the Pages URL above
   (edit it if yours differs).
3. Click **Connect with Slack** → your browser opens Slack's *Allow* screen →
   **Allow**. The tab bounces back and Miting stores your user token locally.

Done — recaps post as you, and channel lists / search work. Nothing secret is
stored anywhere but this device.

## How it works (for the curious)

```
Miting                     Browser                Slack           GitHub Pages
  | PKCE verifier+challenge                          |                 |
  | open authorize URL ----> Slack consent --------> |                 |
  |                          user clicks Allow        |                 |
  |                          <---- 302 redirect ----- |                 |
  |                          GET callback.html?code&state -----------> |
  |                          <-- JS bounce to 127.0.0.1:PORT/cb -------|
  | loopback receives code                            |                 |
  | POST oauth.v2.access (code + verifier, NO secret) --------------->  |
  | <---- xoxp user token ------------------------------------------ |
  | store token locally
```
