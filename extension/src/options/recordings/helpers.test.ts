import { describe, expect, it } from "vitest";
import { activeTranscriptIndex, base64ToBytes, textDirection, transcriptPreview } from "./helpers.js";

describe("recordings helpers", () => {
  it("finds the active transcript segment", () => {
    expect(
      activeTranscriptIndex([
        { start_sec: 0, end_sec: 2, text: "a" },
        { start_sec: 2, end_sec: 4, text: "b" },
      ], 2.5),
    ).toBe(1);
  });

  it("decodes base64 audio chunks", () => {
    expect(Array.from(base64ToBytes("YWJj"))).toEqual([97, 98, 99]);
  });

  it("uses RTL for Persian transcript text", () => {
    expect(textDirection("fa", "سلام")).toBe("rtl");
    expect(textDirection(null, "سلام")).toBe("rtl");
  });

  it("builds concise transcript previews", () => {
    const preview = transcriptPreview([
      { start_sec: 0, end_sec: 1, text: "hello" },
      { start_sec: 1, end_sec: 2, text: "world" },
    ]);
    expect(preview).toBe("hello world");
  });
});
