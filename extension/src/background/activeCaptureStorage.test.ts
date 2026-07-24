import { describe, expect, it } from "vitest";
import { resolveSessionId } from "./activeCaptureStorage.js";

// The stored active capture is the session-id authority for ingest events;
// content-script memory goes stale across restarts (captions=0 orphan bug).

describe("resolveSessionId", () => {
  it("prefers the stored active capture id over the payload id", () => {
    expect(resolveSessionId({ sessionId: "stored-id" }, "stale-content-id")).toBe("stored-id");
  });

  it("falls back to the payload id when nothing is stored", () => {
    expect(resolveSessionId(null, "payload-id")).toBe("payload-id");
  });
});
