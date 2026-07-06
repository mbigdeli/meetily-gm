import { describe, expect, it } from "vitest";
import { buildWhisperTestSessionStart, whisperModelFilename } from "./testSession.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

describe("whisper test session helpers", () => {
  it("maps canonical model names to ggml filenames", () => {
    expect(whisperModelFilename("base")).toBe("ggml-base.bin");
    expect(whisperModelFilename(" Small ")).toBe("ggml-small.bin");
  });

  it("ignores non-canonical model names", () => {
    expect(whisperModelFilename("../base")).toBeNull();
    expect(whisperModelFilename("custom-model.bin")).toBeNull();
  });

  it("builds a local-only session.start payload for microphone tests", () => {
    const payload = buildWhisperTestSessionStart({
      settings: {
        ...DEFAULT_SETTINGS,
        rawStorageRoot: " C:\\Meet\\Raw ",
        finalOutputRoot: " C:\\Meet\\Final ",
        whisperPreferredModel: "tiny",
      },
      sessionId: "whisper-test-1",
      startedAtIso: "2026-05-05T22:00:00.000Z",
      extensionVersion: "0.1.0",
      meetingTitle: " ",
      codexMergeEnabled: false,
    });

    expect(payload).toMatchObject({
      session_id: "whisper-test-1",
      meeting_url: null,
      meeting_code: null,
      meeting_title: "Whisper Voice Test",
      raw_root_path: "C:\\Meet\\Raw",
      final_root_path: "C:\\Meet\\Final",
      codex_merge_enabled: false,
      whisper_model_filename: "ggml-tiny.bin",
    });
  });
});
