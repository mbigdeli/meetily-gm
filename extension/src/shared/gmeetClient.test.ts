import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSession, pauseSession, endSession } from "./gmeetClient.js";
import type { SessionStartRequest } from "./ingestTypes.js";

// gmeetClient talks to the meetily ingest server over HTTP. These tests mock
// chrome.storage.local (pairing) and fetch (resume-check + POSTs) and focus on
// the resume/session-id logic that replaced the extension's old 5-minute timer:
// meetily is the single source of truth for resumability.

const PAIRING = { baseUrl: "http://127.0.0.1:5167", token: "test-token" };
const CODE = "abc-defg-hij";

let pairing: { baseUrl: string; token: string } | undefined;
let resumeCheckBehavior: "ok" | "throw" | "not-ok";
let resumeCheckBody: { resumable: boolean; session_id?: string | null };
let lastStartBody: Record<string, unknown> | null;
let fetchMock: ReturnType<typeof vi.fn>;

function baseRequest(): SessionStartRequest {
  return {
    meeting_code: CODE,
    meeting_title: "Standup",
  } as unknown as SessionStartRequest;
}

beforeEach(() => {
  pairing = { ...PAIRING };
  resumeCheckBehavior = "ok";
  resumeCheckBody = { resumable: false };
  lastStartBody = null;

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: pairing })),
        set: vi.fn(async () => undefined),
      },
    },
  });

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/gmeet/session/resume-check")) {
      if (resumeCheckBehavior === "throw") throw new TypeError("meetily unreachable");
      if (resumeCheckBehavior === "not-ok") return new Response("", { status: 401 });
      return new Response(JSON.stringify(resumeCheckBody), { status: 200 });
    }
    if (url.includes("/gmeet/session/start")) {
      lastStartBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response(
        JSON.stringify({
          meeting_id: lastStartBody?.session_id,
          resumed: lastStartBody?.resume,
        }),
        { status: 200 },
      );
    }
    // pause / end return 204 No Content (null body — 204 forbids a body).
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startSession resume-check", () => {
  it("reuses meetily's session id and flags resume when resumable", async () => {
    resumeCheckBody = { resumable: true, session_id: "gmeet-abc-defg-hij-EXISTING" };

    const result = await startSession(baseRequest());

    expect(result.ok).toBe(true);
    expect(lastStartBody?.session_id).toBe("gmeet-abc-defg-hij-EXISTING");
    expect(lastStartBody?.resume).toBe(true);
    expect(result.data?.meeting_id).toBe("gmeet-abc-defg-hij-EXISTING");
    // resume-check must carry the meeting code.
    const checkUrl = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/resume-check"),
    )?.[0] as string;
    expect(checkUrl).toContain(`meeting_code=${encodeURIComponent(CODE)}`);
  });

  it("mints a fresh id (resume=false) when not resumable", async () => {
    resumeCheckBody = { resumable: false };

    const result = await startSession(baseRequest());

    expect(result.ok).toBe(true);
    expect(lastStartBody?.resume).toBe(false);
    expect(String(lastStartBody?.session_id)).toMatch(/^gmeet-abc-defg-hij-/);
    expect(lastStartBody?.session_id).not.toBe("gmeet-abc-defg-hij-EXISTING");
  });

  it("treats meetily-unreachable as not resumable (fresh start)", async () => {
    resumeCheckBehavior = "throw";

    const result = await startSession(baseRequest());

    expect(result.ok).toBe(true);
    expect(lastStartBody?.resume).toBe(false);
    expect(String(lastStartBody?.session_id)).toMatch(/^gmeet-abc-defg-hij-/);
  });

  it("treats a non-ok resume-check (e.g. 401) as not resumable", async () => {
    resumeCheckBehavior = "not-ok";

    const result = await startSession(baseRequest());

    expect(result.ok).toBe(true);
    expect(lastStartBody?.resume).toBe(false);
  });

  it("ignores a resumable=true response with no session id", async () => {
    resumeCheckBody = { resumable: true, session_id: null };

    await startSession(baseRequest());

    expect(lastStartBody?.resume).toBe(false);
    expect(String(lastStartBody?.session_id)).toMatch(/^gmeet-abc-defg-hij-/);
  });

  it("returns not_paired and never hits the network without a pairing", async () => {
    pairing = undefined;

    const result = await startSession(baseRequest());

    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_paired");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pauseSession / endSession", () => {
  it("pause POSTs the meeting id and stores nothing locally", async () => {
    const result = await pauseSession("gmeet-abc-defg-hij-1");

    expect(result.ok).toBe(true);
    const pauseCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/session/pause"));
    expect(pauseCall).toBeTruthy();
    expect(JSON.parse((pauseCall?.[1] as RequestInit).body as string)).toEqual({
      meeting_id: "gmeet-abc-defg-hij-1",
    });
    // No chrome.storage writes — resumability lives in meetily now.
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("end POSTs the meeting id", async () => {
    const result = await endSession("gmeet-abc-defg-hij-1");

    expect(result.ok).toBe(true);
    const endCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/session/end"));
    expect(JSON.parse((endCall?.[1] as RequestInit).body as string)).toEqual({
      meeting_id: "gmeet-abc-defg-hij-1",
    });
  });
});
