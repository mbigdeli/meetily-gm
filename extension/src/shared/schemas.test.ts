import { describe, expect, it } from "vitest";
import { extensionMessageSchema, meetingCaptureSettingsSchema, parseExtensionMessage } from "./schemas.js";

describe("meetingCaptureSettingsSchema", () => {
  it("accepts valid settings", () => {
    const v = meetingCaptureSettingsSchema.parse({
      localServiceBaseUrl: "http://localhost:3000",
      localServiceTimeoutMs: 5000,
    });
    expect(v.localServiceTimeoutMs).toBe(5000);
    expect(v.rawStorageRoot).toBe("D:\\Meet\\Raw");
    expect(v.whisperPreferredModel).toBe("base");
    expect(v.diarizationSpeakerCountHint).toBeNull();
  });

  it("rejects invalid URL", () => {
    expect(() =>
      meetingCaptureSettingsSchema.parse({
        localServiceBaseUrl: "not-a-url",
        localServiceTimeoutMs: 5000,
      }),
    ).toThrow();
  });

  it("parses extended capture flags", () => {
    const v = meetingCaptureSettingsSchema.parse({
      localServiceBaseUrl: "http://127.0.0.1:17380",
      localServiceTimeoutMs: 5000,
      hideCaptionOverlayWhileParsing: true,
      diarizationSpeakerCountHint: 4,
    });
    expect(v.hideCaptionOverlayWhileParsing).toBe(true);
    expect(v.diarizationSpeakerCountHint).toBe(4);
  });
});

describe("extensionMessageSchema", () => {
  it("parses CAPTURE_START", () => {
    const m = parseExtensionMessage({ type: "CAPTURE_START", payload: {} });
    expect(m.type).toBe("CAPTURE_START");
  });

  it("parses CAPTURE_START with an optional meetTabId", () => {
    const m = parseExtensionMessage({ type: "CAPTURE_START", payload: { meetTabId: 42 } });
    expect(m.type).toBe("CAPTURE_START");
    if (m.type === "CAPTURE_START") {
      expect(m.payload.meetTabId).toBe(42);
    }
  });

  it("parses SETTINGS_UPDATED", () => {
    const m = parseExtensionMessage({
      type: "SETTINGS_UPDATED",
      payload: {
        localServiceBaseUrl: "http://127.0.0.1:1",
        localServiceTimeoutMs: 5000,
      },
    });
    expect(m.type).toBe("SETTINGS_UPDATED");
    if (m.type === "SETTINGS_UPDATED") {
      expect(m.payload.localServiceBaseUrl).toContain("127.0.0.1");
    }
  });

  it("rejects unknown type", () => {
    expect(() => extensionMessageSchema.parse({ type: "UNKNOWN", payload: {} })).toThrow();
  });

  it("parses ENGINE_MODEL_DOWNLOAD", () => {
    const m = parseExtensionMessage({
      type: "ENGINE_MODEL_DOWNLOAD",
      payload: { modelName: "base" },
    });
    expect(m.type).toBe("ENGINE_MODEL_DOWNLOAD");
  });

  it("parses AUDIO_ENABLE_FOR_SESSION", () => {
    const m = parseExtensionMessage({
      type: "AUDIO_ENABLE_FOR_SESSION",
      payload: { sessionId: "session-123" },
    });
    expect(m.type).toBe("AUDIO_ENABLE_FOR_SESSION");
  });

  it("parses recordings list payload", () => {
    const m = parseExtensionMessage({
      type: "REQUEST_RECORDINGS_LIST",
      payload: { limit: 25, offset: 0, query: "standup", state: "ready" },
    });
    expect(m.type).toBe("REQUEST_RECORDINGS_LIST");
  });

  it("rejects oversized recording audio chunks", () => {
    expect(() =>
      parseExtensionMessage({
        type: "REQUEST_RECORDING_AUDIO_CHUNK",
        payload: { sessionId: "s1", offset: 0, length: 999999 },
      }),
    ).toThrow();
  });
});
