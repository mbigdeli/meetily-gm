import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStaleSessionData,
  getLastCaptionLanguage,
  getSessionState,
  getSettings,
  setLastCaptionLanguage,
  setSessionState,
  setSettings,
} from "./storage.js";
import { STORAGE_KEYS } from "./storageKeys.js";
import { DEFAULT_SESSION_STATE, DEFAULT_SETTINGS } from "./types.js";

function mockChromeStorage() {
  const store: Record<string, unknown> = {};

  const local = {
    get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) {
        return { ...store };
      }
      if (typeof keys === "string") {
        return { [keys]: store[keys] };
      }
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          if (k in store) {
            out[k] = store[k];
          }
        }
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(keys)) {
        if (k in store) {
          out[k] = store[k];
        }
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
  };

  vi.stubGlobal("chrome", {
    storage: { local },
  });

  return { store, local };
}

describe("storage wrapper", () => {
  beforeEach(() => {
    mockChromeStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns default settings when unset", async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings with validation", async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      localServiceBaseUrl: "http://127.0.0.1:9999",
      localServiceTimeoutMs: 8000,
      rawStorageRoot: "D:\\captures\\raw",
      finalOutputRoot: "D:\\captures\\final",
      whisperPreferredModel: "small",
    };
    await setSettings(next);
    const s = await getSettings();
    expect(s).toEqual(next);
  });

  it("round-trips session state", async () => {
    const session = {
      ...DEFAULT_SESSION_STATE,
      isCaptureRunning: true,
      currentSessionId: "sess-1",
      currentMeetingTitle: "Standup",
      localServiceStatus: "connected" as const,
    };
    await setSessionState(session);
    const read = await getSessionState();
    expect(read).toEqual(session);
  });

  it("clears stale session data", async () => {
    await setSessionState({
      ...DEFAULT_SESSION_STATE,
      isCaptureRunning: true,
      currentSessionId: "x",
    });
    await clearStaleSessionData();
    const read = await getSessionState();
    expect(read).toEqual(DEFAULT_SESSION_STATE);
  });

  it("persists last caption language", async () => {
    expect(await getLastCaptionLanguage()).toBeNull();
    await setLastCaptionLanguage("fa");
    expect(await getLastCaptionLanguage()).toBe("fa");
    const raw = await chrome.storage.local.get(STORAGE_KEYS.lastCaptionLanguage);
    expect(raw[STORAGE_KEYS.lastCaptionLanguage]).toBe("fa");
  });
});
