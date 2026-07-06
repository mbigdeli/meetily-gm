import type { LiveCaptionLanguage } from "../../shared/types.js";
import { INITIAL_WIDGET_STATE } from "./types.js";
import type { CaptionSnapshot, MeetDomAdapter, MeetUiStorage, MeetWidgetHost, MeetWidgetState } from "./types.js";

export interface MeetUiControllerDeps {
  adapter: MeetDomAdapter;
  storage: MeetUiStorage;
  widget: MeetWidgetHost;
  getMeetingTitle?: () => string | null;
  pollIntervalMs?: number;
  schedulePoll?: (callback: () => void, intervalMs: number) => number;
  clearPoll?: (handle: number) => void;
  delay?: (ms: number) => Promise<void>;
}

export class MeetUiController {
  private readonly getMeetingTitle: () => string | null;
  private readonly pollIntervalMs: number;
  private readonly schedulePoll: (callback: () => void, intervalMs: number) => number;
  private readonly clearPoll: (handle: number) => void;
  private readonly delay: (ms: number) => Promise<void>;

  private pollHandle: number | null = null;
  private started = false;
  private autoReapplyAttempted = false;
  private lastPersistedLanguage: LiveCaptionLanguage | null = null;
  private state: MeetWidgetState = { ...INITIAL_WIDGET_STATE };

  constructor(private readonly deps: MeetUiControllerDeps) {
    this.getMeetingTitle = deps.getMeetingTitle ?? (() => document.title || null);
    this.pollIntervalMs = deps.pollIntervalMs ?? 10_000;
    this.schedulePoll = deps.schedulePoll ?? ((callback, intervalMs) => window.setInterval(callback, intervalMs));
    this.clearPoll = deps.clearPoll ?? ((handle) => window.clearInterval(handle));
    this.delay = deps.delay ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.deps.widget.setLanguageHandler((language) => {
      void this.requestLanguageChange(language);
    });
    this.deps.widget.mount();
    this.render({ ...INITIAL_WIDGET_STATE });
    await this.deps.storage.patchSessionState({
      isMeetPageActive: true,
      currentMeetingTitle: this.getMeetingTitle(),
      lastError: null,
    });
    await this.sync({ allowAutoApply: true });
    this.pollHandle = this.schedulePoll(() => {
      void this.sync({ allowAutoApply: false });
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (this.pollHandle !== null) {
      this.clearPoll(this.pollHandle);
      this.pollHandle = null;
    }
    this.deps.widget.destroy();
    await this.deps.storage.patchSessionState({
      isMeetPageActive: false,
      currentMeetingTitle: null,
    });
  }

  async requestLanguageChange(language: LiveCaptionLanguage): Promise<boolean> {
    return this.applyLanguage(language, "manual");
  }

  private async sync(options: { allowAutoApply: boolean }): Promise<void> {
    try {
      const ready = await this.deps.adapter.detectMeetReady();
      if (!ready) {
        this.render({
          ...this.state,
          mode: "loading",
          captionState: "unknown",
          message: "Waiting for Google Meet to finish loading...",
          busyLanguage: null,
        });
        return;
      }

      const snapshot = await this.deps.adapter.detectCaptionState();
      if (snapshot.language) {
        await this.persistConfirmedLanguage(snapshot.language);
        this.render(this.stateFromSnapshot(snapshot, "Meet caption language detected."));
        return;
      }

      const lastLanguage = await this.deps.storage.getLastCaptionLanguage();
      this.lastPersistedLanguage = lastLanguage;

      if (options.allowAutoApply && !this.autoReapplyAttempted && lastLanguage) {
        this.autoReapplyAttempted = true;
        const didApply = await this.applyLanguage(lastLanguage, "auto");
        if (didApply) {
          return;
        }
      }

      await this.deps.storage.patchSessionState({
        currentLiveCaptionLanguage: null,
        currentMeetingTitle: this.getMeetingTitle(),
      });

      this.render(this.stateFromSnapshot(snapshot, this.messageForSnapshot(snapshot)));
    } catch {
      // Poll errors are absorbed to keep the interval running
    }
  }

  private async applyLanguage(
    language: LiveCaptionLanguage,
    source: "auto" | "manual",
  ): Promise<boolean> {
    const label = language === "fa" ? "Persian" : "English";
    this.render({
      ...this.state,
      mode: "switching",
      busyLanguage: language,
      message:
        source === "auto"
          ? `Reapplying ${label} from your last successful Meet selection...`
          : `Switching Google Meet captions to ${label}...`,
    });

    try {
      const ready = await this.deps.adapter.detectMeetReady();
      if (!ready) {
        await this.fail(`Google Meet is not ready yet, so ${label} could not be applied.`);
        return false;
      }

      const settings = await this.deps.storage.getSettings();
      if (settings.autoEnableLiveCaptions) {
        const enabled = await this.deps.adapter.ensureCaptionsEnabled();
        if (!enabled) {
          await this.fail("Could not enable Google Meet captions from the helper widget.");
          return false;
        }
      }

      const didSelect =
        language === "fa"
          ? await this.deps.adapter.setCaptionLanguageFA()
          : await this.deps.adapter.setCaptionLanguageEN();
      if (!didSelect) {
        await this.fail(`Could not find the Google Meet control for ${label}.`);
        return false;
      }

      const confirmedLanguage = await this.confirmLanguageSelection();
      if (confirmedLanguage !== language) {
        await this.fail(
          `Meet did not confirm a switch to ${label}, so the saved preference was left unchanged.`,
        );
        return false;
      }

      await this.persistConfirmedLanguage(language);
      this.render({
        mode: "ready",
        captionState: "on",
        currentLanguage: language,
        busyLanguage: null,
        message:
          source === "auto"
            ? `Reapplied your saved ${label} caption language.`
            : `Google Meet captions are now set to ${label}.`,
      });
      return true;
    } catch (err) {
      const message = `Language switch to ${label} encountered an error: ${
        err instanceof Error ? err.message : String(err)
      }`;
      await this.fail(message);
      return false;
    }
  }

  private async confirmLanguageSelection(): Promise<LiveCaptionLanguage | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const confirmed = await this.deps.adapter.confirmCaptionLanguage();
      if (confirmed) {
        return confirmed;
      }
      const snapshot = await this.deps.adapter.detectCaptionState();
      if (snapshot.language) {
        return snapshot.language;
      }
      await this.delay(250);
    }
    return null;
  }

  private async persistConfirmedLanguage(language: LiveCaptionLanguage): Promise<void> {
    if (this.lastPersistedLanguage !== language) {
      await this.deps.storage.setLastCaptionLanguage(language);
      this.lastPersistedLanguage = language;
    }
    await this.deps.storage.patchSessionState({
      currentLiveCaptionLanguage: language,
      currentMeetingTitle: this.getMeetingTitle(),
      lastError: null,
    });
  }

  private async fail(message: string): Promise<void> {
    await this.deps.storage.patchSessionState({
      currentMeetingTitle: this.getMeetingTitle(),
      lastError: message,
    });
    this.render({
      ...this.state,
      mode: "error",
      busyLanguage: null,
      message,
    });
  }

  private stateFromSnapshot(snapshot: CaptionSnapshot, message: string): MeetWidgetState {
    return {
      mode: "ready",
      captionState:
        snapshot.enabled === true ? "on" : snapshot.enabled === false ? "off" : "unknown",
      currentLanguage: snapshot.language ?? "unknown",
      busyLanguage: null,
      message,
    };
  }

  private messageForSnapshot(snapshot: CaptionSnapshot): string {
    if (snapshot.enabled === false) {
      return "Captions are currently off in Google Meet.";
    }
    if (snapshot.enabled === true) {
      return "Caption language could not be confirmed yet.";
    }
    return "Waiting for caption controls to become detectable.";
  }

  private render(state: MeetWidgetState): void {
    this.state = state;
    this.deps.widget.render(state);
  }
}
