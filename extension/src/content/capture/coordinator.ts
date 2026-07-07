import type { ExtensionMessage } from "../../shared/messages.js";
import { extractMeetingCode } from "../../shared/meetUtils.js";
import {
  getCaptureSegmentState,
  getLastCaptionLanguage,
  getSessionState,
  getSettings,
  patchSessionState,
  setCaptureSegmentState,
} from "../../shared/storage.js";
import { STORAGE_KEYS } from "../../shared/storageKeys.js";
import type { CaptureSegmentState } from "../../shared/types.js";
import {
  CaptionConsolidator,
  type ConsolidatedLine,
  extractFromRegion,
  findCaptionRegion,
} from "./caption-parser.js";
import { flushCaptureRecordingSegment, isOkResponse, normalizeMeetingTitle } from "./coordinatorUtils.js";
import { extractParticipants } from "./participants.js";
import { StealthCaptionManager } from "./stealth-captions.js";

/**
 * How long to wait between attempts to find the caption region after capture
 * starts. Meet renders the region lazily (only after captions are turned on),
 * so we retry at this interval until the region appears.
 */
const REGION_SEARCH_INTERVAL_MS = 3_000;

/**
 * Maximum number of times to attempt finding the caption region before giving
 * up. 100 × 3 s = 5 minutes — long enough to cover any meeting preamble.
 */
const REGION_SEARCH_MAX_ATTEMPTS = 100;

/**
 * Debounce delay applied to MutationObserver callbacks. Rapid DOM mutations
 * (individual characters being appended to an active utterance) are collapsed
 * into one flush call so we don't hammer the network on every keyframe.
 */
const CAPTION_DEBOUNCE_MS = 200;

const PARTICIPANT_POLL_MS = 45_000;

export class MeetCaptureCoordinator {
  private running = false;
  private starting = false;
  private sessionId: string | null = null;
  private seq = 0;
  private audioSegmentIndex = 0;
  private audioRunning = false;
  /**
   * Long-lived port keeps the MV3 service worker (and its offscreen document)
   * alive while tab audio is recording. Without this, Chrome idles the SW after
   * ~30s, which tears down offscreen and the MediaRecorder — STOP then yields
   * an empty blob and no file is saved.
   */
  private audioKeepAlivePort: chrome.runtime.Port | null = null;

  private captionObserver: MutationObserver | null = null;
  private captionRegion: Element | null = null;
  private regionSearchTimer: ReturnType<typeof setInterval> | null = null;
  private captionDebounce: ReturnType<typeof setTimeout> | null = null;
  private participantTimer: ReturnType<typeof setInterval> | null = null;

  private consolidator = new CaptionConsolidator();

  private stealthCaptions: StealthCaptionManager | null = null;

  constructor(private readonly doc: Document) {}

  private openAudioKeepAlive(): void {
    this.closeAudioKeepAlive();
    try {
      this.audioKeepAlivePort = chrome.runtime.connect({ name: "mcs-audio-session" });
      this.audioKeepAlivePort.onDisconnect.addListener(() => {
        this.audioKeepAlivePort = null;
      });
      console.info("[MCS] audio keep-alive port open (service worker + offscreen stay alive)");
    } catch (e) {
      console.warn("[MCS] audio keep-alive connect failed:", e);
    }
  }

  private closeAudioKeepAlive(): void {
    if (this.audioKeepAlivePort) {
      try {
        this.audioKeepAlivePort.disconnect();
      } catch {
        /* ignore */
      }
      this.audioKeepAlivePort = null;
      console.info("[MCS] audio keep-alive port closed");
    }
  }

  async start(): Promise<void> {
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    window.addEventListener("pagehide", this.onPageHide);
    await this.bootAutoStart();
    void this.maybeStartOrResume();
  }

  private readonly onPageHide = (): void => {
    void this.teardown("pagehide");
  };

  private readonly onRuntimeMessage = (msg: unknown): void => {
    if (typeof msg !== "object" || msg === null || !("type" in msg)) {
      return;
    }
    const t = (msg as { type: string }).type;
    if (t === "CAPTURE_STATE_CHANGED") {
      void this.maybeStartOrResume();
      return;
    }
  };

  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local") {
      return;
    }
    if (changes[STORAGE_KEYS.session]) {
      void this.maybeStartOrResume();
    }
  };

  private async bootAutoStart(): Promise<void> {
    const settings = await getSettings();
    if (!settings.autoStartCaptureWhenMeetDetected) {
      return;
    }
    const s = await getSessionState();
    if (!s.isCaptureRunning) {
      await patchSessionState({ isCaptureRunning: true, lastError: null });
      await chrome.runtime
        .sendMessage({
          type: "CAPTURE_STATE_CHANGED",
          payload: { isCaptureRunning: true },
        } satisfies ExtensionMessage)
        .catch(() => undefined);
    }
  }

  private async maybeStartOrResume(): Promise<void> {
    const session = await getSessionState();
    if (session.isCaptureRunning && !this.running && !this.starting) {
      await this.beginCapture();
    } else if (!session.isCaptureRunning && this.running) {
      await this.teardown("stop_flag");
    }
  }

  private async beginCapture(): Promise<void> {
    if (this.running || this.starting) {
      return;
    }
    this.starting = true;
    try {
      const settings = await getSettings();
      // Meetily-GM: no raw/final storage roots needed — meetily owns storage.
      // (The legacy meeting-capture gate checked those here.)

      await chrome.runtime.sendMessage({ type: "REQUEST_SERVICE_HEALTH", payload: { ensureTray: true } });
      const healthSession = await getSessionState();
      if (
        healthSession.localServiceStatus !== "connected" &&
        healthSession.localServiceStatus !== "tray_starting"
      ) {
        await patchSessionState({
          lastError: "Meeting Capture desktop app is not reachable. Use Test connection in Options to reinstall or restart it.",
          isCaptureRunning: false,
        });
        await chrome.runtime
          .sendMessage({
            type: "CAPTURE_STATE_CHANGED",
            payload: { isCaptureRunning: false },
          } satisfies ExtensionMessage)
          .catch(() => undefined);
        return;
      }

      const meetingCode = extractMeetingCode(this.doc.location.href);
      if (!meetingCode) {
        this.starting = false;
        return;
      }

      const candidateId = crypto.randomUUID();
      const st = await getSessionState();
      const lang = st.currentLiveCaptionLanguage ?? (await getLastCaptionLanguage());

      const startRes = await chrome.runtime.sendMessage({
        type: "INGEST_SESSION_START",
        payload: {
          sessionId: candidateId,
          meetingUrl: this.doc.location.href,
          meetingCode,
          meetingTitle: normalizeMeetingTitle(this.doc.title || ""),
          liveCaptionLanguage: lang,
        },
      });
      if (!isOkResponse(startRes)) {
        const err =
          typeof startRes === "object" && startRes !== null && "error" in startRes
            ? String((startRes as { error: unknown }).error)
            : "session_start_failed";
        await patchSessionState({
          lastError: `Session start failed: ${err}`,
          isCaptureRunning: false,
        });
        await chrome.runtime
          .sendMessage({
            type: "CAPTURE_STATE_CHANGED",
            payload: { isCaptureRunning: false },
          } satisfies ExtensionMessage)
          .catch(() => undefined);
        return;
      }

      const resumed =
        typeof startRes === "object" && startRes !== null && "resumed" in startRes
          ? (startRes as { resumed: boolean }).resumed
          : false;
      const actualSessionId =
        typeof startRes === "object" && startRes !== null && "session_id" in startRes
          ? String((startRes as { session_id: string }).session_id)
          : candidateId;

      if (resumed) {
        const segState = await getCaptureSegmentState();
        if (segState && segState.sessionId === actualSessionId) {
          this.seq = segState.seq;
          this.audioSegmentIndex = segState.audioSegmentIndex + 1;
        } else {
          this.seq = 0;
          this.audioSegmentIndex = 0;
        }
        console.info(`[MCS] session resumed: ${actualSessionId} (meeting: ${meetingCode}, seg=${this.audioSegmentIndex})`);
      } else {
        this.seq = 0;
        this.audioSegmentIndex = 0;
        console.info(`[MCS] session started: ${actualSessionId} (meeting: ${meetingCode})`);
      }

      if (!resumed) {
        await patchSessionState({
          captureRecordingAccumMs: 0,
          captureRecordingSegmentStartedAt: null,
        });
      }

      this.sessionId = actualSessionId;
      this.consolidator.reset();
      await patchSessionState({
        currentSessionId: actualSessionId,
        currentMeetingTitle: normalizeMeetingTitle(this.doc.title || ""),
        isSessionPaused: false,
        lastError: null,
      });

      this.stealthCaptions ??= new StealthCaptionManager(this.doc);
      await this.stealthCaptions.activate();

      this.audioRunning = false;
      if (settings.autoRecordTabAudio) {
        console.info("[MCS] requesting tab audio recording…");
        const audioRes = await chrome.runtime.sendMessage({
          type: "AUDIO_RECORDING_START",
          payload: { sessionId: actualSessionId, audioSegmentIndex: this.audioSegmentIndex },
        });
        if (!isOkResponse(audioRes)) {
          const msg =
            typeof audioRes === "object" && audioRes !== null && "error" in audioRes
              ? String((audioRes as { error: unknown }).error)
              : "audio_start_failed";
          console.error(`[MCS] audio recording failed: ${msg}`);
          await patchSessionState({ lastError: `Tab audio failed (captions continue): ${msg}` });
        } else {
          console.info("[MCS] audio recording started ✓");
          this.audioRunning = true;
          this.openAudioKeepAlive();
        }
      }

      this.startCaptionWatch();
      this.participantTimer = setInterval(() => void this.flushParticipants(), PARTICIPANT_POLL_MS);
      void this.flushParticipants();
      this.running = true;
      await patchSessionState({ captureRecordingSegmentStartedAt: Date.now() });
    } finally {
      this.starting = false;
    }
  }

  /**
   * Attaches a MutationObserver to the caption region. If the region is not
   * yet visible (captions off or Meet still loading), polls at
   * REGION_SEARCH_INTERVAL_MS until it appears, up to REGION_SEARCH_MAX_ATTEMPTS.
   *
   * When the observer fires we debounce by CAPTION_DEBOUNCE_MS to collapse
   * rapid character-by-character DOM updates into a single flush call.
   */
  private startCaptionWatch(): void {
    if (this.tryAttachObserver()) {
      return;
    }

    console.info("[MCS] caption region not visible yet — will retry every 3 s (captions may be off)");
    let attempts = 0;
    this.regionSearchTimer = setInterval(() => {
      attempts += 1;
      if (this.tryAttachObserver() || attempts >= REGION_SEARCH_MAX_ATTEMPTS) {
        if (attempts >= REGION_SEARCH_MAX_ATTEMPTS) {
          console.warn("[MCS] caption region never appeared after 5 min — giving up");
        }
        clearInterval(this.regionSearchTimer!);
        this.regionSearchTimer = null;
      }
    }, REGION_SEARCH_INTERVAL_MS);
  }

  /**
   * Tries to find the caption region and attach a MutationObserver to it.
   * Returns true on success.
   */
  private tryAttachObserver(): boolean {
    if (!this.running && !this.starting) {
      return true; // capture already stopped, abort search
    }
    const region = findCaptionRegion(this.doc);
    if (!region) {
      return false;
    }

    console.info("[MCS] MutationObserver attached to caption region ✓");
    this.captionRegion = region;
    this.captionObserver = new MutationObserver(() => {
      this.scheduleCaptionFlush();
    });
    this.captionObserver.observe(region, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return true;
  }

  /**
   * Schedules a single caption flush after CAPTION_DEBOUNCE_MS. Any further
   * observer callbacks within the window cancel and restart the timer, so
   * only the final state of a rapidly mutating utterance is captured.
   */
  private scheduleCaptionFlush(): void {
    if (this.captionDebounce !== null) {
      clearTimeout(this.captionDebounce);
    }
    this.captionDebounce = setTimeout(() => {
      this.captionDebounce = null;
      void this.flushCaption();
    }, CAPTION_DEBOUNCE_MS);
  }

  private async flushCaption(): Promise<void> {
    const sid = this.sessionId;
    if (!sid || !this.running) {
      return;
    }
    // Use cached region to avoid repeated DOM search and log noise.
    const snap = this.captionRegion
      ? extractFromRegion(this.captionRegion)
      : { captionText: "", speakerHint: null, domSignature: null };
    // Consolidate Meet's incremental captions: emit ONE line per speaker turn
    // (returned only when a turn boundary is crossed), not every growth.
    const line = this.consolidator.process(snap);
    if (line) {
      await this.emitCaptionLine(sid, line);
    }
  }

  /** Send one consolidated caption line to the ingest server. */
  private async emitCaptionLine(sid: string, line: ConsolidatedLine): Promise<void> {
    this.seq += 1;
    console.info(`[MCS] caption #${this.seq} (turn) → speaker="${line.speaker ?? "(none)"}" len=${line.text.length}`);
    const st = await getSessionState();
    const lang = st.currentLiveCaptionLanguage ?? (await getLastCaptionLanguage());
    const source_language_setting = lang === "fa" || lang === "en" ? lang : null;
    const body = {
      captured_at: new Date().toISOString(),
      sequence_number: this.seq,
      caption_text: line.text,
      speaker_hint_text: line.speaker,
      source_language_setting,
      dom_signature: null,
    };
    const r = await chrome.runtime.sendMessage({
      type: "INGEST_CAPTION_EVENT",
      payload: { sessionId: sid, body },
    });
    if (!isOkResponse(r)) {
      const msg =
        typeof r === "object" && r !== null && "error" in r
          ? String((r as { error: unknown }).error)
          : "caption_post_failed";
      console.error(`[MCS] caption upload failed: ${msg}`);
      await patchSessionState({ lastError: `Caption upload: ${msg}` });
    } else {
      console.debug(`[MCS] caption #${this.seq} delivered to local service ✓`);
    }
  }

  private async flushParticipants(): Promise<void> {
    const sid = this.sessionId;
    if (!sid || !this.running) {
      return;
    }
    const participants = extractParticipants(this.doc);
    const body = {
      captured_at: new Date().toISOString(),
      participants,
    };
    const r = await chrome.runtime.sendMessage({
      type: "INGEST_PARTICIPANT_SNAPSHOT",
      payload: { sessionId: sid, body },
    });
    if (!isOkResponse(r)) {
      const msg =
        typeof r === "object" && r !== null && "error" in r
          ? String((r as { error: unknown }).error)
          : "participant_post_failed";
      await patchSessionState({ lastError: `Participant snapshot: ${msg}` });
    }
  }

  async teardown(reason: string): Promise<void> {
    if (!this.running && !this.sessionId) {
      return;
    }
    await flushCaptureRecordingSegment();
    console.info(`[MCS] teardown (reason=${reason}, seq=${this.seq})`);
    this.stealthCaptions?.deactivate();
    this.running = false;
    const hadAudio = this.audioRunning;
    this.audioRunning = false;
    this.doc.getElementById("mcs-capture-badge")?.remove();

    if (this.captionObserver) {
      this.captionObserver.disconnect();
      this.captionObserver = null;
    }
    this.captionRegion = null;
    if (this.regionSearchTimer) {
      clearInterval(this.regionSearchTimer);
      this.regionSearchTimer = null;
    }
    if (this.captionDebounce !== null) {
      clearTimeout(this.captionDebounce);
      this.captionDebounce = null;
    }
    if (this.participantTimer) {
      clearInterval(this.participantTimer);
      this.participantTimer = null;
    }

    const sid = this.sessionId;
    const meetingCode = extractMeetingCode(this.doc.location.href);
    this.sessionId = null;
    if (!sid) {
      // No active session — nothing to flush; just clear consolidator state.
      this.consolidator.reset();
      return;
    }
    // NOTE: do NOT reset the consolidator here — the final in-progress turn is
    // flushed below (consolidator.flush(), which resets internally). Resetting
    // now would discard the last speaker's utterance every meeting.

    if (hadAudio) {
      const keepStream = reason === "stop_flag";
      const audioStop = await chrome.runtime.sendMessage({
        type: "AUDIO_RECORDING_STOP",
        payload: { sessionId: sid, audioSegmentIndex: this.audioSegmentIndex, keepStream },
      });
      if (!isOkResponse(audioStop)) {
        await patchSessionState({
          lastError: `Audio finalize: ${
            typeof audioStop === "object" && audioStop !== null && "error" in audioStop
              ? String((audioStop as { error: unknown }).error)
              : "unknown"
          }`,
        });
      } else if (
        typeof audioStop === "object" &&
        audioStop !== null &&
        "nextSegmentIndex" in audioStop &&
        typeof (audioStop as { nextSegmentIndex?: unknown }).nextSegmentIndex === "number"
      ) {
        this.audioSegmentIndex = Math.max(
          this.audioSegmentIndex,
          (audioStop as { nextSegmentIndex: number }).nextSegmentIndex - 1,
        );
      }
      if (!keepStream) {
        this.closeAudioKeepAlive();
      }
    }

    // Emit the final in-progress caption turn before pausing (else the last
    // utterance of the meeting is lost).
    const finalLine = this.consolidator.flush();
    if (finalLine) {
      await this.emitCaptionLine(sid, finalLine);
    }

    const pausedAt = new Date().toISOString();
    const pauseRes = await chrome.runtime.sendMessage({
      type: "INGEST_SESSION_PAUSE",
      payload: { sessionId: sid, pausedAtIso: pausedAt },
    });
    if (!isOkResponse(pauseRes)) {
      await patchSessionState({
        lastError: `Session pause: ${
          typeof pauseRes === "object" && pauseRes !== null && "error" in pauseRes
            ? String((pauseRes as { error: unknown }).error)
            : "pause_failed"
        }`,
      });
    }

    const segState: CaptureSegmentState = {
      sessionId: sid,
      meetingCode: meetingCode ?? "",
      seq: this.seq,
      audioSegmentIndex: this.audioSegmentIndex,
    };
    await setCaptureSegmentState(segState);

    await patchSessionState({
      currentSessionId: null,
      currentMeetingTitle: null,
      isSessionPaused: true,
    });

    if (
      reason === "pagehide" ||
      reason === "toolbar_removed" ||
      reason === "url_non_meeting"
    ) {
      await patchSessionState({ isCaptureRunning: false, recordingTabId: null });
      await chrome.runtime
        .sendMessage({
          type: "CAPTURE_STATE_CHANGED",
          payload: { isCaptureRunning: false },
        } satisfies ExtensionMessage)
        .catch(() => undefined);
    }
  }
}
