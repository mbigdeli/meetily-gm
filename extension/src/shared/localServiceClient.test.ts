import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalServiceClient,
  checkLocalServiceHealth,
  isHealthyBody,
  normalizeLocalServiceError,
} from "./localServiceClient.js";
import { DEFAULT_SETTINGS } from "./types.js";

/** Configurable native response for the current test. */
let nativeResponse: { success: boolean; payload?: unknown; error?: string } = { success: true, payload: { ok: true } };

beforeEach(() => {
  nativeResponse = { success: true, payload: { ok: true } };
  vi.stubGlobal("chrome", {
    runtime: {
      connectNative: vi.fn(() => {
        const listeners: Array<(msg: unknown) => void> = [];
        return {
          disconnect: vi.fn(),
          postMessage: vi.fn(() => {
            queueMicrotask(() => {
              for (const l of listeners) {
                l(nativeResponse);
              }
            });
          }),
          onMessage: {
            addListener(cb: (msg: unknown) => void) {
              listeners.push(cb);
            },
          },
          onDisconnect: {
            addListener: vi.fn(),
          },
        };
      }),
      lastError: undefined as { message?: string } | undefined,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeLocalServiceError", () => {
  it("classifies AbortError as timeout", () => {
    const e = new DOMException("aborted", "AbortError");
    expect(normalizeLocalServiceError(e).kind).toBe("timeout");
  });

  it("classifies TypeError as network", () => {
    expect(normalizeLocalServiceError(new TypeError("fail")).kind).toBe("network");
  });
});

describe("isHealthyBody", () => {
  it("accepts ok true", () => {
    expect(isHealthyBody({ ok: true })).toBe(true);
  });
  it("accepts status ok", () => {
    expect(isHealthyBody({ status: "ok" })).toBe(true);
  });
  it("rejects arbitrary object", () => {
    expect(isHealthyBody({ status: "bad" })).toBe(false);
  });
});

describe("checkLocalServiceHealth (native)", () => {
  it("returns connected on health.check success", async () => {
    nativeResponse = { success: true, payload: { ok: true } };
    const result = await checkLocalServiceHealth(DEFAULT_SETTINGS);
    expect(result.status).toBe("connected");
    expect(result.httpStatus).toBe(200);
  });

  it("requests tray assurance when asked", async () => {
    nativeResponse = {
      success: true,
      payload: { ok: true, tray: { running: true, stale: false, detail: "tray heartbeat is fresh" } },
    };
    const result = await checkLocalServiceHealth(DEFAULT_SETTINGS, { ensureTray: true });
    expect(result.status).toBe("connected");
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check",
        payload: { ensure_tray: true },
      }),
    );
  });

  it("maps stale tray heartbeat to tray_stopped", async () => {
    nativeResponse = {
      success: true,
      payload: { ok: true, tray: { running: false, stale: true, detail: "tray heartbeat is missing" } },
    };
    const result = await checkLocalServiceHealth(DEFAULT_SETTINGS);
    expect(result.status).toBe("tray_stopped");
  });

  it("maps ensured tray spawn to tray_starting", async () => {
    nativeResponse = {
      success: true,
      payload: {
        ok: true,
        tray: { running: false, stale: true, detail: "tray heartbeat is missing" },
        tray_ensure: { started: true, already_running: false },
      },
    };
    const result = await checkLocalServiceHealth(DEFAULT_SETTINGS, { ensureTray: true });
    expect(result.status).toBe("tray_starting");
  });

  it("returns unavailable when native host is not registered", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        connectNative: vi.fn(() => ({
          disconnect: vi.fn(),
          postMessage: vi.fn(),
          onMessage: { addListener: vi.fn() },
          onDisconnect: {
            addListener: (cb: () => void) => {
              queueMicrotask(cb);
            },
          },
        })),
        lastError: { message: "Specified native messaging host not found." },
      },
    });
    const result = await checkLocalServiceHealth(DEFAULT_SETTINGS);
    expect(result.status).toBe("unavailable");
  });
});

describe("LocalServiceClient native actions", () => {
  it("postEngineModelDownload sends model field for Rust", async () => {
    nativeResponse = { success: true, payload: { status: "not_implemented" } };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const r = await client.postEngineModelDownload("small");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ status: "not_implemented" });
    }
    const cr = chrome.runtime.connectNative as ReturnType<typeof vi.fn>;
    expect(cr).toHaveBeenCalled();
    const port = cr.mock.results[0]?.value as { postMessage: ReturnType<typeof vi.fn> };
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "engine.download",
        payload: { model: "small" },
      }),
    );
  });

  it("getEngineStatus maps to engine.status", async () => {
    nativeResponse = { success: true, payload: { ffmpeg: { available: true }, whisper: { available: false } } };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const r = await client.getEngineStatus();
    expect(r.ok).toBe(true);
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "engine.status" }),
    );
  });

  it("postSessionStart sends session.start payload", async () => {
    nativeResponse = { success: true, payload: { session_id: "sid-1" } };
    const client = new LocalServiceClient(async () => ({
      ...DEFAULT_SETTINGS,
      rawStorageRoot: "C:\\data\\raw",
      finalOutputRoot: "C:\\data\\final",
    }));
    const r = await client.postSessionStart({
      session_id: "sid-1",
      meeting_url: "https://meet.google.com/x",
      meeting_code: "abc-defg-hij",
      meeting_title: "Test",
      started_at: new Date().toISOString(),
      live_caption_language: "en",
      extension_version: "0.1.0",
      raw_root_path: "C:\\data\\raw",
      final_root_path: "C:\\data\\final",
    });
    expect(r.ok).toBe(true);
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    const call = port.postMessage.mock.calls[0][0] as { action: string; payload: { session_id: string } };
    expect(call.action).toBe("session.start");
    expect(call.payload.session_id).toBe("sid-1");
  });

  it("postCaptionEvent includes session_id in native payload", async () => {
    nativeResponse = { success: true, payload: { status: "ok" } };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const r = await client.postCaptionEvent("sid-1", {
      captured_at: new Date().toISOString(),
      sequence_number: 1,
      caption_text: "hi",
      speaker_hint_text: null,
      source_language_setting: "en",
    });
    expect(r.ok).toBe(true);
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    const call = port.postMessage.mock.calls[0][0] as { action: string; payload: Record<string, unknown> };
    expect(call.action).toBe("session.caption");
    expect(call.payload.session_id).toBe("sid-1");
    expect(call.payload.caption_text).toBe("hi");
  });

  it("postSessionAudio sends chunked session.audio", async () => {
    nativeResponse = { success: true, payload: { status: "ok", file: "audio_raw.webm" } };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const bytes = new Uint8Array(500 * 1024 + 1);
    bytes[0] = 7;
    const blob = new Blob([bytes], { type: "audio/webm" });
    const r = await client.postSessionAudio("sid-audio", blob);
    expect(r.ok).toBe(true);
    const cn = chrome.runtime.connectNative as ReturnType<typeof vi.fn>;
    expect(cn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const firstPort = cn.mock.results[0]?.value as { postMessage: ReturnType<typeof vi.fn> };
    const first = firstPort.postMessage.mock.calls[0][0] as { payload: { chunk_index: number; is_last_chunk: boolean } };
    expect(first.payload.chunk_index).toBe(0);
    expect(first.payload.is_last_chunk).toBe(false);
  });

  it("getSessionStatus maps to session.status", async () => {
    nativeResponse = { success: true, payload: { session_id: "sid-status", jobs: [] } };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const r = await client.getSessionStatus("sid-status");
    expect(r.ok).toBe(true);
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.status",
        payload: { session_id: "sid-status" },
      }),
    );
  });

  it("listRecordings maps filters to sessions.list", async () => {
    nativeResponse = { success: true, payload: { items: [], total: 0, limit: 10, offset: 0 } };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const r = await client.listRecordings({ limit: 10, offset: 0, query: "daily", state: "ready" });
    expect(r.ok).toBe(true);
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sessions.list",
        payload: { limit: 10, offset: 0, query: "daily", state: "ready" },
      }),
    );
  });

  it("getRecordingAudioChunk maps to bounded chunk action", async () => {
    nativeResponse = {
      success: true,
      payload: {
        session_id: "sid-audio",
        offset: 0,
        length: 3,
        byte_length: 3,
        data_base64: "YWJj",
        is_eof: true,
        mime_type: "audio/mpeg",
      },
    };
    const client = new LocalServiceClient(async () => DEFAULT_SETTINGS);
    const r = await client.getRecordingAudioChunk("sid-audio", 0, 3);
    expect(r.ok).toBe(true);
    const port = (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>;
    };
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.recording.chunk",
        payload: { session_id: "sid-audio", offset: 0, length: 3 },
      }),
    );
  });
});
