import type { SessionState } from "./types.js";

/**
 * Active recording time for UI: accumulated completed segments plus the current segment (if any).
 * Pause time is excluded because the segment clock is cleared on pause.
 */
export function getRecordingElapsedMs(session: SessionState, nowMs: number = Date.now()): number {
  const base = session.captureRecordingAccumMs ?? 0;
  const start = session.captureRecordingSegmentStartedAt;
  if (start == null) {
    return base;
  }
  return base + Math.max(0, nowMs - start);
}
