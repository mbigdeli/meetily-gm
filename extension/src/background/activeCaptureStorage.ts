export interface ActiveCapture {
  tabId: number;
  sessionId: string;
  hasAudio: boolean;
}

const ACTIVE_CAPTURE_KEY = "mcs_active_capture_v1";

/**
 * The session id ingest events must carry: the stored active capture wins over
 * the id the content script remembers. Content-script memory goes stale when
 * the session is re-adopted after an extension/SW restart — sending events
 * under the stale id orphaned them server-side (the captions=0 bug).
 */
export function resolveSessionId(
  active: Pick<ActiveCapture, "sessionId"> | null,
  payloadSessionId: string,
): string {
  return active?.sessionId ?? payloadSessionId;
}

export async function getActiveCapture(): Promise<ActiveCapture | null> {
  const result = await chrome.storage.local.get(ACTIVE_CAPTURE_KEY);
  const raw = result[ACTIVE_CAPTURE_KEY];
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as ActiveCapture).tabId === "number" &&
    typeof (raw as ActiveCapture).sessionId === "string" &&
    typeof (raw as ActiveCapture).hasAudio === "boolean"
  ) {
    return raw as ActiveCapture;
  }
  return null;
}

export async function setActiveCapture(capture: ActiveCapture | null): Promise<void> {
  if (capture === null) {
    await chrome.storage.local.remove(ACTIVE_CAPTURE_KEY);
  } else {
    await chrome.storage.local.set({ [ACTIVE_CAPTURE_KEY]: capture });
  }
}
