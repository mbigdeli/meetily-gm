import { describe, expect, it } from "vitest";
import { extractMeetingCode } from "./meetUtils.js";

describe("extractMeetingCode (shared meetUtils)", () => {
  it("parses Meet code from path", () => {
    expect(extractMeetingCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
  });

  it("returns null when absent", () => {
    expect(extractMeetingCode("https://meet.google.com/landing")).toBeNull();
  });

  it("returns null for /new page", () => {
    expect(extractMeetingCode("https://meet.google.com/new")).toBeNull();
  });

  it("returns null for /new with query params (observed corrupted session URL)", () => {
    expect(extractMeetingCode("https://meet.google.com/new?authuser=0&hs=178")).toBeNull();
  });

  it("returns null for Meet home page (no room code)", () => {
    expect(extractMeetingCode("https://meet.google.com/")).toBeNull();
  });

  it("returns the code case-insensitively", () => {
    expect(extractMeetingCode("https://meet.google.com/ABC-DEFG-HIJ")).toBe("ABC-DEFG-HIJ");
  });

  it("parses room code when pathname has a trailing slash", () => {
    expect(extractMeetingCode("https://meet.google.com/abc-defg-hij/")).toBe("abc-defg-hij");
  });
});

describe("URL guard: non-room URLs must return null from extractMeetingCode", () => {
  const blockedUrls = [
    "https://meet.google.com/new",
    "https://meet.google.com/new?authuser=0&hs=178",
    "https://meet.google.com/",
    "https://meet.google.com",
    "https://meet.google.com/landing",
    "https://meet.google.com/about",
  ];

  for (const url of blockedUrls) {
    it(`blocks ${url}`, () => {
      expect(extractMeetingCode(url)).toBeNull();
    });
  }
});

describe("URL guard: real room URLs must return non-null from extractMeetingCode", () => {
  const allowedUrls = [
    "https://meet.google.com/abc-defg-hij",
    "https://meet.google.com/xyz-abcd-efg",
    "https://meet.google.com/aaa-bbbb-ccc?authuser=0",
  ];

  for (const url of allowedUrls) {
    it(`allows ${url}`, () => {
      expect(extractMeetingCode(url)).not.toBeNull();
    });
  }
});
