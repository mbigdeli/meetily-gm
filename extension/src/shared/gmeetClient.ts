/**
 * Meetily-GM Google Meet ingest client.
 *
 * Replaces the old Native Messaging transport. The companion extension now
 * POSTs Google Meet captions / participants / session lifecycle to the meetily
 * desktop app's localhost ingest server (see src-tauri/src/gmeet_ingest).
 *
 * Meetily owns audio (system-audio loopback) and all AI/model concerns; the
 * extension's only job is to feed Meet's named captions + roster + metadata.
 */

import type {
  CaptionEventRequest,
  ParticipantSnapshotRequest,
  SessionStartRequest,
} from "./ingestTypes.js";

const PAIRING_KEY = "mcs_gmeet_pairing";
const DEFAULT_BASE_URL = "http://127.0.0.1:5167";

export interface GmeetPairing {
  baseUrl: string;
  token: string;
}

export interface GmeetResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Read the stored pairing (base URL + token) the user set from meetily Settings. */
export async function getGmeetPairing(): Promise<GmeetPairing | null> {
  const stored = await chrome.storage.local.get(PAIRING_KEY);
  const raw = stored[PAIRING_KEY] as Partial<GmeetPairing> | undefined;
  if (!raw || typeof raw.token !== "string" || raw.token.length === 0) {
    return null;
  }
  return {
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl ? raw.baseUrl : DEFAULT_BASE_URL,
    token: raw.token,
  };
}

export async function setGmeetPairing(pairing: GmeetPairing): Promise<void> {
  await chrome.storage.local.set({
    [PAIRING_KEY]: {
      baseUrl: pairing.baseUrl || DEFAULT_BASE_URL,
      token: pairing.token,
    },
  });
}

async function post<T = unknown>(path: string, body: unknown): Promise<GmeetResult<T>> {
  const pairing = await getGmeetPairing();
  if (!pairing) {
    return { ok: false, error: "not_paired" };
  }
  try {
    const resp = await fetch(`${pairing.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairing.token}`,
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 401) {
      return { ok: false, error: "unauthorized" };
    }
    if (!resp.ok) {
      return { ok: false, error: `http_${resp.status}` };
    }
    // Some endpoints return 204 No Content.
    const text = await resp.text();
    const data = text ? (JSON.parse(text) as T) : undefined;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Health probe — used to show connection status in the popup/options. */
export async function checkGmeetHealth(): Promise<GmeetResult> {
  const pairing = await getGmeetPairing();
  if (!pairing) {
    return { ok: false, error: "not_paired" };
  }
  try {
    const resp = await fetch(`${pairing.baseUrl}/gmeet/health`);
    return { ok: resp.ok, error: resp.ok ? undefined : `http_${resp.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function startSession(
  body: SessionStartRequest,
): Promise<GmeetResult<{ meeting_id: string; resumed: boolean }>> {
  return post("/gmeet/session/start", {
    meeting_code: body.meeting_code,
    title: body.meeting_title,
    participants: [],
  });
}

export async function sendCaption(
  meetingId: string,
  body: CaptionEventRequest,
): Promise<GmeetResult> {
  const tsMs =
    typeof body.start_offset_sec === "number" ? Math.round(body.start_offset_sec * 1000) : null;
  return post("/gmeet/captions", {
    meeting_id: meetingId,
    captions: [
      {
        speaker: body.speaker_hint_text ?? null,
        text: body.caption_text,
        ts_ms: tsMs,
      },
    ],
  });
}

export async function sendParticipants(
  meetingId: string,
  body: ParticipantSnapshotRequest,
): Promise<GmeetResult> {
  return post("/gmeet/participants", {
    meeting_id: meetingId,
    participants: body.participants.map((p) => p.display_name).filter(Boolean),
  });
}

export async function endSession(meetingId: string): Promise<GmeetResult> {
  return post("/gmeet/session/end", { meeting_id: meetingId });
}
