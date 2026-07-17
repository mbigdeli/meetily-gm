import { getGmeetPairing, setGmeetPairing, type GmeetPairing } from "./gmeetClient.js";
import { nativeHostRequest } from "./nativeHost.js";

const PAIRING_TIMEOUT_MS = 3_000;

interface PairingPayload {
  base_url?: unknown;
  token?: unknown;
}

function parsePairing(payload: unknown): GmeetPairing | null {
  const p = payload as PairingPayload | null | undefined;
  if (!p || typeof p.token !== "string" || p.token.length === 0) {
    return null;
  }
  return {
    baseUrl: typeof p.base_url === "string" && p.base_url ? p.base_url : "http://127.0.0.1:5167",
    token: p.token,
  };
}

/**
 * Zero-touch pairing (doc 15 §4): if no pairing is stored, ask the desktop
 * app's native-messaging host for it. Chrome only lets THIS extension launch
 * the host (`allowed_origins` pins our ID), so the channel itself is the
 * authorization — no user-visible secret.
 *
 * Returns the effective pairing, or null when the host isn't installed
 * (desktop app never run) — callers fall back to the manual Options flow.
 */
export async function ensureGmeetPairing(force = false): Promise<GmeetPairing | null> {
  if (!force) {
    const existing = await getGmeetPairing();
    if (existing) {
      return existing;
    }
  }
  const resp = await nativeHostRequest(PAIRING_TIMEOUT_MS, "pairing.get", {});
  if (!resp.ok) {
    console.warn("[MCS] auto-pairing unavailable:", resp.error);
    return getGmeetPairing();
  }
  const pairing = parsePairing(resp.data);
  if (!pairing) {
    console.warn("[MCS] auto-pairing: malformed payload from host");
    return getGmeetPairing();
  }
  await setGmeetPairing(pairing);
  console.info("[MCS] auto-paired with desktop app via native host");
  return pairing;
}
