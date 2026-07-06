import { describe, expect, it } from "vitest";
import { getRecordingElapsedMs } from "./recordingTimer.js";
import { DEFAULT_SESSION_STATE } from "./types.js";

describe("getRecordingElapsedMs", () => {
  it("returns only accumulated ms when no active segment", () => {
    const session = {
      ...DEFAULT_SESSION_STATE,
      captureRecordingAccumMs: 60_000,
      captureRecordingSegmentStartedAt: null,
    };
    expect(getRecordingElapsedMs(session, 1_000_000)).toBe(60_000);
  });

  it("adds elapsed wall time for the active segment", () => {
    const session = {
      ...DEFAULT_SESSION_STATE,
      captureRecordingAccumMs: 30_000,
      captureRecordingSegmentStartedAt: 500_000,
    };
    expect(getRecordingElapsedMs(session, 530_000)).toBe(60_000);
  });

  it("never returns negative delta for segment", () => {
    const session = {
      ...DEFAULT_SESSION_STATE,
      captureRecordingAccumMs: 100,
      captureRecordingSegmentStartedAt: 1_000_000,
    };
    expect(getRecordingElapsedMs(session, 999_000)).toBe(100);
  });
});
