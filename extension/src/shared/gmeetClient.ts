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

/**
 * Optional hook the service worker registers to re-fetch pairing from the
 * native host (see shared/autoPairing.ts). Injected instead of imported to
 * keep this module free of a gmeetClient <-> autoPairing import cycle.
 */
let pairingRefresher: (() => Promise<GmeetPairing | null>) | null = null;

export function setPairingRefresher(refresh: () => Promise<GmeetPairing | null>): void {
  pairingRefresher = refresh;
}

async function postOnce<T = unknown>(
  pairing: GmeetPairing,
  path: string,
  body: unknown,
): Promise<GmeetResult<T>> {
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

async function post<T = unknown>(path: string, body: unknown): Promise<GmeetResult<T>> {
  let pairing = await getGmeetPairing();
  if (!pairing && pairingRefresher) {
    pairing = await pairingRefresher();
  }
  if (!pairing) {
    return { ok: false, error: "not_paired" };
  }
  const first = await postOnce<T>(pairing, path, body);
  // Stale token (e.g. app re-minted it): refresh over native messaging once, retry once.
  if (!first.ok && first.error === "unauthorized" && pairingRefresher) {
    const refreshed = await pairingRefresher();
    if (refreshed && refreshed.token !== pairing.token) {
      return postOnce<T>(refreshed, path, body);
    }
  }
  return first;
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

// --- session continuity across pause/resume -------------------------------
// Meetily — not the extension — is the single source of truth for whether a
// just-left Meet can be resumed into the same session. Before starting we ask
// GET /gmeet/session/resume-check?meeting_code=X; if meetily reports a paused,
// not-yet-finalized session for this code we reuse its id (resume), otherwise
// we mint a fresh one. Meetily clears resumability when it finalizes (grace
// expiry / "Stop & summarize now") or resumes, so there is no independent
// extension timer to drift out of sync with the frontend grace countdown —
// which was the root of the resume/session-id desync bug family.

function genId(code: string): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return `gmeet-${code}-${rand}`;
}

interface ResumeCheck {
  resumable: boolean;
  session_id?: string | null;
}

/**
 * Ask meetily whether this meeting_code has a resumable paused session. On any
 * failure (meetily unreachable, unauthorized, bad response) we treat it as not
 * resumable so a fresh session is started rather than blocking the recording.
 */
async function resumeCheck(pairing: GmeetPairing, code: string): Promise<ResumeCheck> {
  try {
    const url = `${pairing.baseUrl}/gmeet/session/resume-check?meeting_code=${encodeURIComponent(code)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${pairing.token}` },
    });
    if (!resp.ok) return { resumable: false };
    const data = (await resp.json()) as ResumeCheck;
    return {
      resumable: data.resumable === true,
      session_id: typeof data.session_id === "string" ? data.session_id : null,
    };
  } catch {
    return { resumable: false };
  }
}

export async function startSession(
  body: SessionStartRequest,
): Promise<GmeetResult<{ meeting_id: string; resumed: boolean }>> {
  const pairing = await getGmeetPairing();
  if (!pairing) {
    return { ok: false, error: "not_paired" };
  }
  const code = body.meeting_code || "adhoc";
  const check = await resumeCheck(pairing, code);
  let sessionId: string;
  let resume = false;
  if (check.resumable && check.session_id) {
    sessionId = check.session_id;
    resume = true;
  } else {
    sessionId = genId(code);
  }

  // Meetily validates `resume` authoritatively and returns the id it actually
  // used (in `meeting_id`), which may differ if the session was finalized in
  // the meantime — the caller adopts that returned id.
  return post("/gmeet/session/start", {
    meeting_code: body.meeting_code,
    title: body.meeting_title,
    participants: [],
    session_id: sessionId,
    resume,
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

/**
 * Meet closed/paused: pause meetily, which marks the session resumable and
 * starts its grace window. Resumability is tracked by meetily (keyed by meeting
 * code), so nothing is stored here.
 */
export async function pauseSession(meetingId: string): Promise<GmeetResult> {
  return post("/gmeet/session/pause", { meeting_id: meetingId });
}

/**
 * Finalize a session over the wire. Meetily clears the session's resumability
 * on this path too (in addition to its own frontend finalize), so the next
 * join of this Meet starts fresh.
 */
export async function endSession(meetingId: string): Promise<GmeetResult> {
  return post("/gmeet/session/end", { meeting_id: meetingId });
}
