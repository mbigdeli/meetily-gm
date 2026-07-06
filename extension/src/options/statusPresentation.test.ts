import { describe, expect, it } from "vitest";
import type { LocalServiceJsonResult } from "../shared/localServiceClient.js";
import {
  describeCodexStatus,
  describeMicPermission,
  describeRemoteStatus,
  describeServiceStatus,
} from "./statusPresentation.js";

describe("statusPresentation", () => {
  it("describes Codex connected state with rollover wording (not a hard re-login deadline)", () => {
    const result: LocalServiceJsonResult = {
      ok: true,
      httpStatus: 200,
      data: {
        connected: true,
        authenticated: true,
        user_email: "a@b.co",
        expires_at: 1_800_000_000_000,
      },
    };
    const view = describeCodexStatus(result);
    expect(view.isConnected).toBe(true);
    expect(view.summary).toContain("rolls over");
    expect(view.summary).toContain("refreshes");
  });

  it("maps connected service status to a positive summary", () => {
    const view = describeServiceStatus("connected");
    expect(view.tone).toBe("success");
    expect(view.chipLabel).toBe("Connected");
    expect(view.summary).toContain("reachable");
  });

  it("maps tray lifecycle service statuses", () => {
    expect(describeServiceStatus("tray_starting").chipLabel).toBe("Starting");
    expect(describeServiceStatus("tray_stopped").chipLabel).toBe("Tray stopped");
  });

  it("maps prompt microphone permission to a required state", () => {
    const view = describeMicPermission("prompt");
    expect(view.tone).toBe("warning");
    expect(view.chipLabel).toBe("Required");
    expect(view.summary).toContain("not been granted");
  });

  it("summarizes healthy remote responses with diagnostics", () => {
    const result: LocalServiceJsonResult = {
      ok: true,
      httpStatus: 200,
      data: { ready: true, status: "ready", active_model: "base" },
    };

    const view = describeRemoteStatus("Engine", result);
    expect(view.tone).toBe("success");
    expect(view.summary).toContain("ready");
    expect(view.details).toContain("\"active_model\": \"base\"");
  });

  it("surfaces remote failures as attention states", () => {
    const result: LocalServiceJsonResult = {
      ok: false,
      httpStatus: 503,
      error: "Service unavailable",
      data: { detail: "offline" },
    };

    const view = describeRemoteStatus("Codex", result);
    expect(view.tone).toBe("error");
    expect(view.chipLabel).toBe("Needs attention");
    expect(view.summary).toContain("HTTP 503");
    expect(view.details).toContain("\"detail\": \"offline\"");
  });
});
