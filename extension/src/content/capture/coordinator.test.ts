import { describe, expect, it } from "vitest";
import { extractMeetingCode } from "../../shared/meetUtils.js";

/**
 * Full URL guard matrices live in `src/shared/meetUtils.test.ts`.
 * This file keeps a direct contract check next to `MeetCaptureCoordinator` / `beginCapture`.
 */
describe("MeetCaptureCoordinator / beginCapture URL gate", () => {
  it("uses shared extractMeetingCode: null blocks session start", () => {
    expect(extractMeetingCode("https://meet.google.com/new")).toBeNull();
  });

  it("uses shared extractMeetingCode: non-null allows room detection", () => {
    expect(extractMeetingCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
  });
});
