import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../shared/types.js";
import { DEFAULT_SESSION_STATE } from "../../shared/types.js";
import { MeetUiController } from "./controller.js";
import type { CaptionSnapshot, MeetDomAdapter, MeetUiStorage, MeetWidgetHost, MeetWidgetState } from "./types.js";

class FakeWidget implements MeetWidgetHost {
  readonly states: MeetWidgetState[] = [];
  private handler: ((language: "fa" | "en") => void) | null = null;

  mount(): void {}

  render(state: MeetWidgetState): void {
    this.states.push({ ...state });
  }

  setLanguageHandler(handler: (language: "fa" | "en") => void): void {
    this.handler = handler;
  }

  isCaptureRunning(): boolean {
    return false;
  }

  destroy(): void {}

  click(language: "fa" | "en"): void {
    this.handler?.(language);
  }
}

function createStorage(overrides?: Partial<MeetUiStorage>): MeetUiStorage & {
  patchCalls: Array<Record<string, unknown>>;
  savedLanguages: Array<"fa" | "en">;
} {
  const patchCalls: Array<Record<string, unknown>> = [];
  const savedLanguages: Array<"fa" | "en"> = [];
  let lastCaptionLanguage: "fa" | "en" | null = "fa";

  return {
    patchCalls,
    savedLanguages,
    async getSettings() {
      return {
        localServiceBaseUrl: "http://127.0.0.1:17380",
        localServiceTimeoutMs: 5000,
        rawStorageRoot: "C:\\raw",
        finalOutputRoot: "C:\\final",
        keepRawFilesAfterProcessing: true,
        autoOpenFinalOutputFolder: false,
        autoStartCaptureWhenMeetDetected: false,
        autoEnableLiveCaptions: true,
        hideCaptionOverlayWhileParsing: false,
        autoRecordTabAudio: true,
        whisperPreferredModel: "base",
        whisperDevicePreference: "auto",
        whisperComputeType: "auto",
        diarizationEnabled: true,
        diarizationSpeakerCountHint: null,
        codexMergeEnabled: true,
        codexGenerateSummary: true,
        codexGenerateActionItems: true,
        codexGenerateDecisions: true,
      };
    },
    async getLastCaptionLanguage() {
      return lastCaptionLanguage;
    },
    async setLastCaptionLanguage(language) {
      lastCaptionLanguage = language;
      savedLanguages.push(language);
    },
    async patchSessionState(partial) {
      patchCalls.push(partial as Record<string, unknown>);
      return { ...DEFAULT_SESSION_STATE, ...partial } as SessionState;
    },
    ...overrides,
  };
}

function createAdapter(
  snapshot: CaptionSnapshot,
  overrides?: Partial<MeetDomAdapter>,
): MeetDomAdapter {
  return {
    detectMeetReady: vi.fn(async () => true),
    detectCaptionState: vi.fn(async () => snapshot),
    ensureCaptionsEnabled: vi.fn(async () => true),
    openCaptionControls: vi.fn(async () => true),
    setCaptionLanguageFA: vi.fn(async () => true),
    setCaptionLanguageEN: vi.fn(async () => true),
    confirmCaptionLanguage: vi.fn(async () => snapshot.language),
    ...overrides,
  };
}

describe("MeetUiController", () => {
  it("reapplies the stored language when Meet is ready", async () => {
    const widget = new FakeWidget();
    const storage = createStorage();
    const adapter = createAdapter(
      { enabled: true, language: null },
      {
        confirmCaptionLanguage: vi.fn(async (): Promise<"fa"> => "fa"),
      },
    );

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: () => 1,
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    await controller.start();

    expect(storage.savedLanguages).toEqual([]);
    expect(widget.states.at(-1)?.currentLanguage).toBe("fa");
    expect(widget.states.at(-1)?.message).toContain("Reapplied");
  });

  it("persists a manually detected Meet language change", async () => {
    const widget = new FakeWidget();
    const storage = createStorage({
      getLastCaptionLanguage: async () => "fa",
    });
    const adapter = createAdapter({ enabled: true, language: "en" });

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: () => 1,
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    await controller.start();

    expect(storage.savedLanguages).toEqual(["en"]);
    expect(widget.states.at(-1)?.currentLanguage).toBe("en");
  });

  it("does not persist when a requested switch cannot be confirmed", async () => {
    const widget = new FakeWidget();
    const storage = createStorage();
    const adapter = createAdapter(
      { enabled: true, language: null },
      {
        confirmCaptionLanguage: vi.fn(async () => null),
      },
    );

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: () => 1,
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    await controller.start();
    storage.savedLanguages.length = 0;

    const changed = await controller.requestLanguageChange("en");

    expect(changed).toBe(false);
    expect(storage.savedLanguages).toEqual([]);
    expect(widget.states.at(-1)?.mode).toBe("error");
  });

  it("shows caption-off state when captions are disabled", async () => {
    const widget = new FakeWidget();
    const storage = createStorage({
      getLastCaptionLanguage: async () => null,
    });
    const adapter = createAdapter({ enabled: false, language: null });

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: () => 1,
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    await controller.start();

    expect(widget.states.at(-1)?.captionState).toBe("off");
    expect(widget.states.at(-1)?.message).toContain("Captions are currently off");
  });

  it("resolves false and enters error state when setCaptionLanguageFA throws", async () => {
    const widget = new FakeWidget();
    const storage = createStorage({
      getLastCaptionLanguage: async () => null,
    });
    const adapter = createAdapter(
      { enabled: true, language: null },
      {
        setCaptionLanguageFA: vi.fn(async () => {
          throw new Error("DOM not found");
        }),
      },
    );

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: () => 1,
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    await controller.start();

    const result = await controller.requestLanguageChange("fa");

    expect(result).toBe(false);
    expect(widget.states.at(-1)?.mode).toBe("error");
    expect(widget.states.at(-1)?.message).toContain("Language switch");
  });

  it("resolves false and enters error state when detectMeetReady throws during applyLanguage", async () => {
    const widget = new FakeWidget();
    const storage = createStorage({
      getLastCaptionLanguage: async () => null,
    });
    let callCount = 0;
    const adapter = createAdapter(
      { enabled: true, language: null },
      {
        detectMeetReady: vi.fn(async () => {
          callCount += 1;
          if (callCount > 1) {
            throw new Error("DOM not ready");
          }
          return true;
        }),
      },
    );

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: () => 1,
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    await controller.start();

    const result = await controller.requestLanguageChange("fa");

    expect(result).toBe(false);
    expect(widget.states.at(-1)?.mode).toBe("error");
    expect(widget.states.at(-1)?.message).toContain("Language switch");
  });

  it("does not produce an uncaught rejection when sync adapter throws", async () => {
    const widget = new FakeWidget();
    const storage = createStorage({
      getLastCaptionLanguage: async () => null,
    });

    let pollCallback: (() => void) | null = null;
    const adapter = createAdapter(
      { enabled: false, language: null },
      {
        detectMeetReady: vi.fn(async () => {
          throw new Error("adapter exploded");
        }),
      },
    );

    const controller = new MeetUiController({
      adapter,
      storage,
      widget,
      schedulePoll: (cb) => {
        pollCallback = cb;
        return 1;
      },
      clearPoll: () => undefined,
      delay: async () => undefined,
      getMeetingTitle: () => "Weekly sync",
    });

    // start() calls sync() internally; it should not throw even though adapter throws
    await expect(controller.start()).resolves.toBeUndefined();

    // Manually fire poll tick; should not throw
    if (pollCallback) {
      const tick = (pollCallback as () => void | Promise<void>)();
      if (tick instanceof Promise) {
        await expect(tick).resolves.toBeUndefined();
      }
    }
  });
});
