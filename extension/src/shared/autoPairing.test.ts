import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ensureGmeetPairing: zero-touch pairing over native messaging (doc 15 §4).
// chrome.storage.local holds the pairing; nativeHostRequest is mocked per test.

const nativeHostRequestMock = vi.fn();
vi.mock("./nativeHost.js", () => ({
  nativeHostRequest: (...args: unknown[]) => nativeHostRequestMock(...args),
}));

import { ensureGmeetPairing } from "./autoPairing.js";

const PAIRING_KEY = "mcs_gmeet_pairing";
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = {};
  nativeHostRequestMock.mockReset();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(stored, obj);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureGmeetPairing", () => {
  it("keeps existing pairing without touching the native host", async () => {
    stored[PAIRING_KEY] = { baseUrl: "http://127.0.0.1:5167", token: "existing" };
    const pairing = await ensureGmeetPairing();
    expect(pairing?.token).toBe("existing");
    expect(nativeHostRequestMock).not.toHaveBeenCalled();
  });

  it("fetches and stores pairing from the host when nothing is stored", async () => {
    nativeHostRequestMock.mockResolvedValue({
      ok: true,
      data: { base_url: "http://127.0.0.1:5167", token: "host-token" },
    });
    const pairing = await ensureGmeetPairing();
    expect(nativeHostRequestMock).toHaveBeenCalledWith(expect.any(Number), "pairing.get", {});
    expect(pairing?.token).toBe("host-token");
    expect((stored[PAIRING_KEY] as { token: string }).token).toBe("host-token");
  });

  it("force refresh overwrites a stale stored token", async () => {
    stored[PAIRING_KEY] = { baseUrl: "http://127.0.0.1:5167", token: "stale" };
    nativeHostRequestMock.mockResolvedValue({
      ok: true,
      data: { base_url: "http://127.0.0.1:5167", token: "fresh" },
    });
    const pairing = await ensureGmeetPairing(true);
    expect(pairing?.token).toBe("fresh");
    expect((stored[PAIRING_KEY] as { token: string }).token).toBe("fresh");
  });

  it("falls back to stored pairing when the host is not installed", async () => {
    stored[PAIRING_KEY] = { baseUrl: "http://127.0.0.1:5167", token: "manual" };
    nativeHostRequestMock.mockResolvedValue({ ok: false, error: "host not found" });
    const pairing = await ensureGmeetPairing(true);
    expect(pairing?.token, "manual pairing must survive a dead host").toBe("manual");
  });

  it("ignores malformed host payloads", async () => {
    nativeHostRequestMock.mockResolvedValue({ ok: true, data: { nope: 1 } });
    const pairing = await ensureGmeetPairing();
    expect(pairing).toBeNull();
    expect(stored[PAIRING_KEY]).toBeUndefined();
  });
});
