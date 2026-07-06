import { getSessionState, patchSessionState } from "../../shared/storage.js";

export function normalizeMeetingTitle(title: string): string {
  return title.replace(/\s+-\s+Google Meet$/i, "").trim();
}

export function isOkResponse(r: unknown): r is { ok: true } {
  return typeof r === "object" && r !== null && "ok" in r && (r as { ok: unknown }).ok === true;
}

/** Fold the in-progress segment into accumulated recording time (pause-safe). */
export async function flushCaptureRecordingSegment(): Promise<void> {
  const s = await getSessionState();
  if (s.captureRecordingSegmentStartedAt == null) {
    return;
  }
  const add = Date.now() - s.captureRecordingSegmentStartedAt;
  await patchSessionState({
    captureRecordingAccumMs: s.captureRecordingAccumMs + add,
    captureRecordingSegmentStartedAt: null,
  });
}
