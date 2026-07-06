import { LocalServiceClient } from "../shared/localServiceClient.js";
import { nativeHostRequest } from "../shared/nativeHost.js";
import type { SessionStartRequest } from "../shared/ingestTypes.js";
import {
  startSession as gmeetStartSession,
  sendCaption as gmeetSendCaption,
  sendParticipants as gmeetSendParticipants,
  endSession as gmeetEndSession,
} from "../shared/gmeetClient.js";
import type { ExtensionMessage, SettingsAndSessionResponse } from "../shared/messages.js";
import type { CurrentMeetingSnapshot, RecordingReadiness } from "../shared/recordingsTypes.js";
import { extensionMessageSchema, liveCaptionLanguageSchema, meetingCaptureSettingsSchema } from "../shared/schemas.js";
import {
  getLastCaptionLanguage,
  getSessionState,
  getSettings,
  patchSessionState,
  setLastCaptionLanguage,
  setSettings,
} from "../shared/storage.js";
import { STORAGE_KEYS } from "../shared/storageKeys.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";
import { getActiveCapture, setActiveCapture, type ActiveCapture } from "./activeCaptureStorage.js";
import { setBadgeRecording } from "./badge.js";

const HEALTH_ALARM = "mcs-local-service-health";

const serviceClient = new LocalServiceClient(getSettings);

/**
 * Stream ID pre-fetched eagerly inside the CAPTURE_START handler while the
 * user-gesture context is still alive. Consumed once by AUDIO_RECORDING_START.
 * Chrome's tabCapture.getMediaStreamId requires a recent user gesture in MV3
 * service workers; attempting it later (after multiple async message hops) will
 * fail with "Extension has not been invoked for the current page".
 */
let pendingStreamId: { tabId: number; streamId: string } | null = null;

/**
 * Set to true when offscreen stops recording with keepStream=true (pause),
 * meaning the tab capture stream is still alive in the offscreen document.
 * Reset to false on full stop or when a new stream is acquired.
 */
let offscreenStreamAlive = false;

/**
 * Monotonic generation counter incremented on every CAPTURE_START / STOP.
 * If a STOP arrives while a slow START is still running (offscreen setup),
 * the START will detect the generation mismatch and abort instead of
 * overwriting the newer "stopped" state.
 */
let captureGeneration = 0;

/**
 * Tells offscreen to stop recording AND upload directly to the local service.
 * The offscreen doc does the fetch() itself since chrome.runtime.sendMessage
 * cannot transfer ArrayBuffer/Blob between offscreen↔SW (known Chrome bug).
 */
async function stopOffscreenAndUpload(sessionId: string, segmentIndex?: number, keepStream = false): Promise<{ uploaded: boolean; error?: string; nextSegmentIndex?: number }> {
  const settings = await getSettings();
  const reply = (await chrome.runtime.sendMessage({
    type: "OFFSCREEN_RECORD_STOP",
    sessionId,
    serviceBaseUrl: settings.localServiceBaseUrl,
    segmentIndex: segmentIndex ?? null,
    keepStream,
  })) as { ok?: boolean; uploaded?: boolean; error?: string; reason?: string; nextSegmentIndex?: number } | null;
  if (!reply?.ok) {
    const err = reply?.error ?? "offscreen_stop_failed";
    console.error(`[MCS:bg] offscreen stop failed: ${err}`);
    offscreenStreamAlive = false;
    return { uploaded: false, error: err };
  }
  offscreenStreamAlive = keepStream;
  if (reply.uploaded) {
    console.info("[MCS:bg] offscreen uploaded audio directly ✓");
    return { uploaded: true, nextSegmentIndex: reply.nextSegmentIndex };
  }
  console.warn(`[MCS:bg] offscreen did not upload: ${reply.reason ?? reply.error ?? "unknown"}`);
  return { uploaded: false, error: reply.reason ?? reply.error };
}

/**
 * Pauses a session from the background when the Meet tab closes unexpectedly.
 * Saves any in-progress audio segment and sends a pause to the local service.
 * The server-side watchdog will auto-finalize if the user doesn't rejoin within
 * the grace period.
 */
async function pauseSessionFromBackground(capture: ActiveCapture): Promise<void> {
  console.info(
    `[MCS:bg] pausing session ${capture.sessionId} (hasAudio=${capture.hasAudio})`,
  );
  try {
    if (capture.hasAudio) {
      try {
        const result = await stopOffscreenAndUpload(capture.sessionId);
        if (!result.uploaded) {
          console.error(`[MCS:bg] pauseSession: audio not uploaded (${result.error ?? "unknown"})`);
        }
      } catch (e) {
        console.error(`[MCS:bg] pauseSession audio: ${e instanceof Error ? e.message : e}`);
      }
    }
    const pausedAt = new Date().toISOString();
    const pauseResult = await serviceClient.postSessionPause(capture.sessionId, pausedAt);
    if (pauseResult.ok) {
      console.info("[MCS:bg] session paused ✓ (watchdog will finalize if no rejoin)");
    } else {
      console.error(`[MCS:bg] session pause failed: ${pauseResult.error}`);
    }
  } catch (e) {
    console.error(`[MCS:bg] pauseSession error: ${e instanceof Error ? e.message : e}`);
  }
  await patchSessionState({
    isCaptureRunning: false,
    recordingTabId: null,
    currentSessionId: null,
    currentMeetingTitle: null,
    captureRecordingAccumMs: 0,
    captureRecordingSegmentStartedAt: null,
  }).catch(() => undefined);
}

async function ensureOffscreenDocument(): Promise<void> {
  const RT = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: { contextTypes: string[] }) => Promise<Array<{ contextType: string }>>;
  };
  if (typeof RT.getContexts === "function") {
    try {
      const ctxs = await RT.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      if (ctxs.length > 0) {
        return;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("offscreen.html"),
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Record Google Meet tab audio for local transcription.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("Only a single offscreen")) {
      throw e;
    }
  }
}

/**
 * Pings the offscreen document until it responds, confirming that its message
 * listener is registered. Chrome parses and executes the offscreen script
 * asynchronously after createDocument resolves, so a race condition exists if
 * we send OFFSCREEN_RECORD_START immediately. We retry for up to ~1.5 s with
 * 150 ms gaps before giving up (best effort — recording proceeds anyway).
 */
async function waitForOffscreenReady(maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const reply = (await chrome.runtime.sendMessage({
        type: "OFFSCREEN_PING",
      })) as { ok?: boolean } | null;
      if (reply?.ok) {
        console.info(`[MCS:bg] offscreen ready after ${i + 1} attempt(s) ✓`);
        return;
      }
    } catch {
      // listener not yet registered — wait and retry
    }
    await new Promise<void>((r) => setTimeout(r, 150));
  }
  console.warn("[MCS:bg] offscreen did not respond to PING — proceeding anyway");
}

async function getTabMediaStreamId(tabId: number): Promise<string> {
  const api = chrome.tabCapture as typeof chrome.tabCapture & {
    getMediaStreamId?: (opts: { targetTabId: number }) => Promise<string>;
  };
  if (typeof api.getMediaStreamId !== "function") {
    throw new Error("tabCapture.getMediaStreamId_unavailable");
  }
  return api.getMediaStreamId({ targetTabId: tabId });
}

function assertMeetSender(sender: chrome.runtime.MessageSender): void {
  if (!sender.url?.startsWith("https://meet.google.com/")) {
    throw new Error("invalid_sender");
  }
}

async function ensureDefaultSettingsPersisted(): Promise<void> {
  const raw = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (raw[STORAGE_KEYS.settings] === undefined) {
    await setSettings({ ...DEFAULT_SETTINGS });
  }
}

async function refreshServiceHealth(ensureTray = false): Promise<void> {
  const health = await serviceClient.checkHealth({ ensureTray });
  await patchSessionState({
    localServiceStatus: health.status,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readinessFromNativeStatus(data: unknown): RecordingReadiness | "processing" | "none" {
  if (!isRecord(data)) {
    return "none";
  }
  if (typeof data.last_error === "string" && data.last_error.length > 0) {
    return "failed";
  }
  const overall = typeof data.overall_state === "string" ? data.overall_state : "";
  if (overall === "active") {
    return "recording";
  }
  if (overall === "paused") {
    return "paused";
  }
  const files = isRecord(data.output_files) ? data.output_files : {};
  const processed = Array.isArray(files.processed) ? files.processed : [];
  const finalFiles = Array.isArray(files.final) ? files.final : [];
  const raw = Array.isArray(files.raw) ? files.raw : [];
  const hasAudio = processed.includes("processed/audio.mp3") || processed.includes("processed/audio.wav");
  const hasTranscript =
    finalFiles.includes("final/final_transcript.json") ||
    processed.includes("processed/transcript.json") ||
    raw.includes("raw/caption_events.jsonl");
  if (hasAudio && hasTranscript) {
    return "ready";
  }
  if (hasAudio) {
    return "audio_only";
  }
  if (hasTranscript) {
    return "transcript_only";
  }
  if (overall === "ended" || overall === "reprocessing") {
    return "processing";
  }
  return "none";
}

async function handleMessage(raw: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return { ok: false, error: "Invalid message" };
  }

  switch (raw.type) {
    case "OFFSCREEN_RECORD_STATS": {
      // From offscreen: live MediaRecorder chunk stats → forward to Meet tab badge.
      const totalBytes = typeof (raw as { totalBytes?: unknown }).totalBytes === "number"
        ? (raw as { totalBytes: number }).totalBytes
        : 0;
      const chunkCount = typeof (raw as { chunkCount?: unknown }).chunkCount === "number"
        ? (raw as { chunkCount: number }).chunkCount
        : 0;
      const cap = await getActiveCapture();
      if (cap?.tabId !== undefined) {
        await chrome.tabs
          .sendMessage(cap.tabId, {
            type: "AUDIO_RECORD_STATS",
            payload: { totalBytes, chunkCount },
          })
          .catch(() => undefined);
      }
      return { ok: true };
    }

    case "OFFSCREEN_NATIVE_AUDIO_CHUNK": {
      const sessionId = typeof (raw as { sessionId?: unknown }).sessionId === "string"
        ? (raw as { sessionId: string }).sessionId
        : "";
      const dataBase64 =
        typeof (raw as { dataBase64?: unknown }).dataBase64 === "string"
          ? (raw as { dataBase64: string }).dataBase64
          : "";
      const contentType =
        typeof (raw as { contentType?: unknown }).contentType === "string"
          ? (raw as { contentType: string }).contentType
          : "audio/webm";
      const chunkIndex =
        typeof (raw as { chunkIndex?: unknown }).chunkIndex === "number"
          ? (raw as { chunkIndex: number }).chunkIndex
          : 0;
      const isLastChunk = (raw as { isLast?: unknown }).isLast === true;
      const seg = (raw as { segmentIndex?: unknown }).segmentIndex;
      const segmentIndex = typeof seg === "number" ? seg : null;
      const segmentStartedAt =
        typeof (raw as { segmentStartedAt?: unknown }).segmentStartedAt === "string"
          ? (raw as { segmentStartedAt: string }).segmentStartedAt
          : null;
      const segmentEndedAt =
        typeof (raw as { segmentEndedAt?: unknown }).segmentEndedAt === "string"
          ? (raw as { segmentEndedAt: string }).segmentEndedAt
          : null;
      const sessionStartOffsetSec =
        typeof (raw as { sessionStartOffsetSec?: unknown }).sessionStartOffsetSec === "number"
          ? (raw as { sessionStartOffsetSec: number }).sessionStartOffsetSec
          : null;
      const durationSec =
        typeof (raw as { durationSec?: unknown }).durationSec === "number"
          ? (raw as { durationSec: number }).durationSec
          : null;
      const overlapPrevSec =
        typeof (raw as { overlapPrevSec?: unknown }).overlapPrevSec === "number"
          ? (raw as { overlapPrevSec: number }).overlapPrevSec
          : null;
      const overlapNextSec =
        typeof (raw as { overlapNextSec?: unknown }).overlapNextSec === "number"
          ? (raw as { overlapNextSec: number }).overlapNextSec
          : null;

      if (!sessionId || !dataBase64) {
        return { ok: false, error: "missing_session_or_payload" };
      }

      const settings = await getSettings();
      const payload: Record<string, unknown> = {
        session_id: sessionId,
        content_type: contentType,
        data_base64: dataBase64,
        chunk_index: chunkIndex,
        is_last_chunk: isLastChunk,
      };
      if (segmentIndex !== null) {
        payload.segment_index = segmentIndex;
      }
      if (segmentStartedAt !== null) payload.segment_started_at = segmentStartedAt;
      if (segmentEndedAt !== null) payload.segment_ended_at = segmentEndedAt;
      if (sessionStartOffsetSec !== null) payload.session_start_offset_sec = sessionStartOffsetSec;
      if (durationSec !== null) payload.duration_sec = durationSec;
      if (overlapPrevSec !== null) payload.overlap_prev_sec = overlapPrevSec;
      if (overlapNextSec !== null) payload.overlap_next_sec = overlapNextSec;

      const r = await nativeHostRequest(settings.localServiceTimeoutMs, "session.audio", payload);
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      return { ok: true };
    }

    case "PING":
      return { ok: true, pong: true };

    case "REQUEST_SETTINGS": {
      const settings = await getSettings();
      const session = await getSessionState();
      const lastCaptionLanguage = await getLastCaptionLanguage();
      const body: SettingsAndSessionResponse = {
        settings,
        session,
        lastCaptionLanguage,
      };
      return { ok: true, ...body };
    }

    case "REQUEST_SESSION_STATUS": {
      const session = await getSessionState();
      return { ok: true, session };
    }

    case "SETTINGS_UPDATED": {
      const parsed = meetingCaptureSettingsSchema.parse(raw.payload);
      await setSettings(parsed);
      await refreshServiceHealth();
      return { ok: true };
    }

    case "REQUEST_SERVICE_HEALTH": {
      const parsed = extensionMessageSchema.safeParse(raw);
      const ensureTray =
        parsed.success && parsed.data.type === "REQUEST_SERVICE_HEALTH"
          ? parsed.data.payload.ensureTray === true
          : false;
      await refreshServiceHealth(ensureTray);
      const session = await getSessionState();
      return { ok: true, session };
    }

    case "REQUEST_CURRENT_MEETING": {
      const session = await getSessionState();
      const activeCapture = await getActiveCapture();
      const sessionId = session.currentSessionId ?? activeCapture?.sessionId ?? null;
      let nativeStatus: unknown = null;
      let transcriptReadiness: CurrentMeetingSnapshot["transcriptReadiness"] = sessionId
        ? "loading"
        : "none";
      if (sessionId) {
        const status = await serviceClient.getSessionStatus(sessionId);
        if (status.ok) {
          nativeStatus = status.data;
          transcriptReadiness = readinessFromNativeStatus(status.data);
        } else {
          transcriptReadiness = "failed";
          nativeStatus = { error: status.error };
        }
      }
      const snapshot: CurrentMeetingSnapshot = {
        ...session,
        activeCapture,
        nativeStatus,
        transcriptReadiness,
      };
      return { ok: true, currentMeeting: snapshot };
    }

    case "REQUEST_RECORDINGS_LIST": {
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "REQUEST_RECORDINGS_LIST") {
        return { ok: false, error: "Invalid recordings list payload" };
      }
      const result = await serviceClient.listRecordings(parsed.data.payload);
      return { ok: result.ok, result };
    }

    case "REQUEST_RECORDING_TRANSCRIPT": {
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "REQUEST_RECORDING_TRANSCRIPT") {
        return { ok: false, error: "Invalid recording transcript payload" };
      }
      const result = await serviceClient.getRecordingTranscript(parsed.data.payload.sessionId);
      return { ok: result.ok, result };
    }

    case "REQUEST_RECORDING_AUDIO_INFO": {
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "REQUEST_RECORDING_AUDIO_INFO") {
        return { ok: false, error: "Invalid recording audio payload" };
      }
      const result = await serviceClient.getRecordingAudioInfo(parsed.data.payload.sessionId);
      return { ok: result.ok, result };
    }

    case "REQUEST_RECORDING_AUDIO_CHUNK": {
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "REQUEST_RECORDING_AUDIO_CHUNK") {
        return { ok: false, error: "Invalid recording audio chunk payload" };
      }
      const { sessionId, offset, length } = parsed.data.payload;
      const result = await serviceClient.getRecordingAudioChunk(sessionId, offset, length);
      return { ok: result.ok, result };
    }

    case "REQUEST_ENGINE_STATUS": {
      const result = await serviceClient.getEngineStatus();
      return { ok: true, result };
    }

    case "REQUEST_CODEX_STATUS": {
      const result = await serviceClient.getCodexStatus();
      return { ok: true, result };
    }

    case "ENGINE_INSTALL": {
      const result = await serviceClient.postEngineInstall();
      return { ok: true, result };
    }

    case "ENGINE_MODEL_DOWNLOAD": {
      const pl = isRecord(raw.payload) ? raw.payload : {};
      const modelName = typeof pl.modelName === "string" ? pl.modelName.trim() : "";
      if (!modelName) {
        return { ok: false, error: "modelName is required" };
      }
      const result = await serviceClient.postEngineModelDownload(modelName);
      return { ok: true, result };
    }

    case "CODEX_LOGIN": {
      let startResult = await serviceClient.postCodexLoginStart();

      // Auto-recover from stale OAuth lock left by a previous incomplete login
      if (!startResult.ok && startResult.error === "login_already_in_progress") {
        console.info("[MCS:bg] clearing stale OAuth lock and retrying login_start");
        await serviceClient.postCodexResetLogin();
        startResult = await serviceClient.postCodexLoginStart();
      }

      if (!startResult.ok) {
        return { ok: false, error: startResult.error ?? "login_start_failed" };
      }
      // Codex CLI opens the browser itself; auth_url is only present with
      // transports that need us to open the sign-in tab.
      const data = startResult.data as { auth_url?: string | null } | undefined;
      const authUrl = data?.auth_url;
      if (typeof authUrl === "string" && authUrl.length > 0) {
        await chrome.tabs.create({ url: authUrl });
      }
      return { ok: true, polling: true };
    }

    case "CODEX_DISCONNECT": {
      const result = await serviceClient.postCodexDisconnect();
      return { ok: result.ok, result };
    }

    case "FLASH_BADGE": {
      const flashTabId = sender.tab?.id;
      const flashOpts = flashTabId !== undefined ? { tabId: flashTabId } : {};
      if (flashTabId !== undefined) {
        await chrome.storage.local.set({
          mcs_awaiting_capture_click: { tabId: flashTabId, ts: Date.now() },
        });
      }
      let tick = 0;
      const total = 8;
      const iv = setInterval(async () => {
        const on = tick % 2 === 0;
        await chrome.action.setBadgeText({ text: on ? " ● " : "", ...flashOpts });
        await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8", ...flashOpts });
        tick++;
        if (tick >= total) {
          clearInterval(iv);
          const s = await getSessionState();
          await setBadgeRecording(s.isCaptureRunning, flashTabId);
        }
      }, 400);
      try {
        const iconUrl = chrome.runtime.getURL("icon128.png");
        chrome.notifications.create("mcs-invoke-hint", {
          type: "basic",
          iconUrl,
          title: "Meeting Capture",
          message: "Click the extension icon to start recording. Audio cannot be captured without this step.",
          priority: 2,
        });
      } catch {
        // icon file missing — badge flash is enough
      }
      return { ok: true };
    }

    case "CAPTURE_START": {
      const gen = ++captureGeneration;
      const payloadMeetTabId =
        isRecord(raw.payload) && typeof raw.payload.meetTabId === "number"
          ? (raw.payload.meetTabId as number)
          : undefined;
      const meetTabId = payloadMeetTabId ?? sender.tab?.id;

      let hasStreamId = false;
      if (meetTabId !== undefined) {
        if (pendingStreamId?.tabId === meetTabId) {
          hasStreamId = true;
          console.info(`[MCS:bg] reusing pre-fetched stream ID for tab ${meetTabId} ✓`);
        } else {
          try {
            const sid = await getTabMediaStreamId(meetTabId);
            pendingStreamId = { tabId: meetTabId, streamId: sid };
            hasStreamId = true;
            console.info(`[MCS:bg] stream ID obtained for tab ${meetTabId} ✓`);
          } catch (e) {
            console.info(`[MCS:bg] getMediaStreamId unavailable: ${e instanceof Error ? e.message : e}`);
          }
        }
      }

      if (!hasStreamId && !offscreenStreamAlive) {
        return { ok: false, needsInvocation: true };
      }

      await ensureOffscreenDocument();
      await waitForOffscreenReady();

      if (gen !== captureGeneration) {
        console.warn("[MCS:bg] CAPTURE_START aborted: a newer stop/start arrived during offscreen setup");
        return { ok: false, needsInvocation: false };
      }

      await patchSessionState({ isCaptureRunning: true, recordingTabId: meetTabId ?? null, lastError: null });
      await setBadgeRecording(true, meetTabId);
      await chrome.storage.local.remove("mcs_awaiting_capture_click");
      await chrome.runtime.sendMessage({
        type: "CAPTURE_STATE_CHANGED",
        payload: { isCaptureRunning: true },
      } satisfies ExtensionMessage).catch(() => undefined);
      return { ok: true };
    }

    case "CAPTURE_STOP": {
      ++captureGeneration;
      pendingStreamId = null;
      const prevSession = await getSessionState();
      const stopTabId = prevSession.recordingTabId ?? sender.tab?.id;
      await patchSessionState({ isCaptureRunning: false });
      await setBadgeRecording(false, stopTabId ?? undefined);
      await chrome.runtime.sendMessage({
        type: "CAPTURE_STATE_CHANGED",
        payload: { isCaptureRunning: false },
      } satisfies ExtensionMessage).catch(() => undefined);
      return { ok: true };
    }

    case "CAPTURE_STOP_WITH_PREFETCH": {
      ++captureGeneration;
      const prevSessionPf = await getSessionState();
      const pfTabId = prevSessionPf.recordingTabId ?? sender.tab?.id;
      const prefetchTabId = sender.tab?.id;
      if (prefetchTabId !== undefined) {
        try {
          const sid = await getTabMediaStreamId(prefetchTabId);
          pendingStreamId = { tabId: prefetchTabId, streamId: sid };
          console.info(`[MCS:bg] pre-fetched stream ID for next recording on tab ${prefetchTabId} ✓`);
        } catch (e) {
          console.warn(`[MCS:bg] pre-fetch failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      await patchSessionState({ isCaptureRunning: false });
      await setBadgeRecording(false, pfTabId ?? undefined);
      await chrome.runtime.sendMessage({
        type: "CAPTURE_STATE_CHANGED",
        payload: { isCaptureRunning: false },
      } satisfies ExtensionMessage).catch(() => undefined);
      return { ok: true };
    }

    case "EMERGENCY_STOP": {
      const prevSessionEs = await getSessionState();
      const esTabId = prevSessionEs.recordingTabId ?? sender.tab?.id;
      await patchSessionState({
        isCaptureRunning: false,
        recordingTabId: null,
        lastError: "Emergency stop requested",
        captureRecordingAccumMs: 0,
        captureRecordingSegmentStartedAt: null,
      });
      await setBadgeRecording(false, esTabId ?? undefined);
      await chrome.runtime.sendMessage({
        type: "CAPTURE_STATE_CHANGED",
        payload: { isCaptureRunning: false },
      } satisfies ExtensionMessage).catch(() => undefined);
      return { ok: true };
    }

    case "CAPTION_LANGUAGE_CHANGED": {
      const pl = isRecord(raw.payload) ? raw.payload : {};
      const language = liveCaptionLanguageSchema.safeParse(pl.language);
      if (!language.success) {
        return { ok: false, error: "Invalid caption language" };
      }
      await setLastCaptionLanguage(language.data);
      await patchSessionState({ currentLiveCaptionLanguage: language.data });
      return { ok: true };
    }

    case "INGEST_SESSION_START": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "INGEST_SESSION_START") {
        return { ok: false, error: "invalid_payload" };
      }
      const p = parsed.data.payload;
      const settings = await getSettings();
      const mv = chrome.runtime.getManifest();
      const whisperModel = settings.whisperPreferredModel.trim().toLowerCase();
      const knownModels = ["tiny", "base", "small", "medium", "large", "large-v3"];
      const whisper_model_filename = knownModels.includes(whisperModel)
        ? `ggml-${whisperModel === "large" ? "large-v3" : whisperModel}.bin`
        : null;
      const body: SessionStartRequest = {
        session_id: p.sessionId,
        meeting_url: p.meetingUrl,
        meeting_code: p.meetingCode,
        meeting_title: p.meetingTitle,
        started_at: new Date().toISOString(),
        live_caption_language: p.liveCaptionLanguage,
        extension_version: mv.version ?? "0.0.0",
        raw_root_path: settings.rawStorageRoot.trim(),
        final_root_path: settings.finalOutputRoot.trim(),
        codex_merge_enabled: settings.codexMergeEnabled,
        whisper_model_filename,
      };
      // Meetily-GM: send to the desktop app's gmeet ingest server over HTTP.
      // We adopt meetily's meeting_id as our session id so every subsequent
      // caption/participant/end event carries it directly (no id mapping).
      const result = await gmeetStartSession(body);
      if (!result.ok) {
        return { ok: false, error: result.error, detail: result };
      }
      const meetingId = result.data?.meeting_id ?? p.sessionId;
      const resumed = result.data?.resumed === true;
      if (sender.tab?.id !== undefined) {
        await setActiveCapture({ tabId: sender.tab.id, sessionId: meetingId, hasAudio: false });
      }
      return { ok: true, resumed, session_id: meetingId };
    }

    case "INGEST_CAPTION_EVENT": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "INGEST_CAPTION_EVENT") {
        return { ok: false, error: "invalid_payload" };
      }
      const { sessionId, body } = parsed.data.payload;
      const result = await gmeetSendCaption(sessionId, body);
      if (!result.ok) {
        return { ok: false, error: result.error, detail: result };
      }
      return { ok: true };
    }

    case "INGEST_PARTICIPANT_SNAPSHOT": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "INGEST_PARTICIPANT_SNAPSHOT") {
        return { ok: false, error: "invalid_payload" };
      }
      const { sessionId, body } = parsed.data.payload;
      const result = await gmeetSendParticipants(sessionId, body);
      if (!result.ok) {
        return { ok: false, error: result.error, detail: result };
      }
      return { ok: true };
    }

    case "INGEST_SESSION_PAUSE": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "INGEST_SESSION_PAUSE") {
        return { ok: false, error: "invalid_payload" };
      }
      // Meetily-GM: captions drive the gmeet transcript, so pause is a no-op
      // on the ingest side (nothing to pause; meetily owns any audio recording).
      void parsed.data.payload;
      return { ok: true };
    }

    case "INGEST_SESSION_END": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "INGEST_SESSION_END") {
        return { ok: false, error: "invalid_payload" };
      }
      const { sessionId } = parsed.data.payload;
      const result = await gmeetEndSession(sessionId);
      if (!result.ok) {
        return { ok: false, error: result.error, detail: result };
      }
      const endedCapture = await getActiveCapture();
      if (endedCapture?.sessionId === sessionId) {
        await setActiveCapture(null);
      }
      return { ok: true };
    }

    case "AUDIO_RECORDING_START": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "AUDIO_RECORDING_START") {
        return { ok: false, error: "invalid_payload" };
      }
      const { sessionId, audioSegmentIndex } = parsed.data.payload;
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return { ok: false, error: "no_tab" };
      }
      const settings = await getSettings();
      if (!settings.autoRecordTabAudio) {
        return { ok: true, skipped: true };
      }
      console.info("[MCS:bg] AUDIO_RECORDING_START — ensuring offscreen document…");
      await ensureOffscreenDocument();
      await waitForOffscreenReady();
      let streamId: string;
      if (pendingStreamId?.tabId === tabId) {
        streamId = pendingStreamId.streamId;
        pendingStreamId = null;
        console.info("[MCS:bg] using pre-fetched stream ID ✓");
      } else {
        try {
          streamId = await getTabMediaStreamId(tabId);
          console.info(`[MCS:bg] tab stream ID obtained (${streamId.slice(0, 12)}…)`);
        } catch (e) {
          // No stream ID available — offscreen may hold a live stream
          // from a paused recording, so pass empty string and let it try.
          streamId = "";
          console.info(`[MCS:bg] no stream ID, relying on offscreen live stream: ${e instanceof Error ? e.message : e}`);
        }
      }
      const micFlagArs = await chrome.storage.local.get("mcs_mic_permission_granted");
      const recordMicArs = micFlagArs.mcs_mic_permission_granted === true;
      const reply = (await chrome.runtime.sendMessage({
        type: "OFFSCREEN_RECORD_START",
        sessionId,
        streamId,
        recordMic: recordMicArs,
        initialSegmentIndex: audioSegmentIndex ?? 0,
      })) as { ok?: boolean; error?: string };
      if (!reply?.ok) {
        console.error(`[MCS:bg] offscreen RECORD_START rejected: ${reply?.error ?? "unknown"}`);
        return { ok: false, error: reply?.error ?? "offscreen_start_failed" };
      }
      console.info("[MCS:bg] audio pipeline started end-to-end ✓");
      const acStart = await getActiveCapture();
      if (acStart?.sessionId === sessionId) {
        await setActiveCapture({ ...acStart, hasAudio: true });
      }
      return { ok: true };
    }

    case "AUDIO_ENABLE_FOR_SESSION": {
      // Triggered by the in-page badge button click.  The user gesture from that
      // click propagates here, but the gesture window is short — call
      // getMediaStreamId as the very first await, before any cross-context IPC
      // (offscreen setup), to guarantee we're still within the gesture window.
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "AUDIO_ENABLE_FOR_SESSION") {
        return { ok: false, error: "invalid_payload" };
      }
      const { sessionId } = parsed.data.payload;
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return { ok: false, error: "no_tab" };
      }
      console.info(`[MCS:bg] AUDIO_ENABLE_FOR_SESSION — grabbing stream ID immediately (tab=${tabId})`);

      // ── Step 1: Grab stream ID while gesture is still active ──────────────
      let streamId: string;
      try {
        streamId = await getTabMediaStreamId(tabId);
        console.info(`[MCS:bg] stream ID obtained from badge click ✓`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tab_capture_failed";
        console.error(`[MCS:bg] AUDIO_ENABLE_FOR_SESSION getMediaStreamId failed: ${msg}`);
        return { ok: false, error: msg };
      }

      // ── Step 2: Set up offscreen document (gesture no longer needed) ──────
      await ensureOffscreenDocument();
      await waitForOffscreenReady();

      // ── Step 3: Start recording ────────────────────────────────────────────
      const micFlagAef = await chrome.storage.local.get("mcs_mic_permission_granted");
      const recordMicAef = micFlagAef.mcs_mic_permission_granted === true;
      const startReply = (await chrome.runtime.sendMessage({
        type: "OFFSCREEN_RECORD_START",
        sessionId,
        streamId,
        recordMic: recordMicAef,
        initialSegmentIndex: 0,
      })) as { ok?: boolean; error?: string };
      if (!startReply?.ok) {
        console.error(`[MCS:bg] offscreen RECORD_START rejected: ${startReply?.error ?? "unknown"}`);
        return { ok: false, error: startReply?.error ?? "offscreen_start_failed" };
      }
      const acBadge = await getActiveCapture();
      if (acBadge && acBadge.sessionId === sessionId) {
        await setActiveCapture({ ...acBadge, hasAudio: true });
      }
      console.info("[MCS:bg] audio started via in-page badge ✓");
      return { ok: true };
    }

    case "OPEN_OPTIONS_PAGE": {
      void chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    case "AUDIO_RECORDING_STOP": {
      assertMeetSender(sender);
      const parsed = extensionMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.type !== "AUDIO_RECORDING_STOP") {
        return { ok: false, error: "invalid_payload" };
      }
      const { sessionId, audioSegmentIndex, keepStream } = parsed.data.payload;
      const acStop = await getActiveCapture();
      if (acStop?.sessionId === sessionId) {
        await setActiveCapture({ ...acStop, hasAudio: false });
      }
      const result = await stopOffscreenAndUpload(sessionId, audioSegmentIndex, keepStream === true);
      if (!result.uploaded) {
        console.error(`[MCS:bg] AUDIO_RECORDING_STOP: ${result.error ?? "not_uploaded"}`);
      }
      return { ok: true, uploaded: result.uploaded, nextSegmentIndex: result.nextSegmentIndex };
    }

    default:
      return { ok: false, error: `Unhandled type: ${raw.type}` };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureDefaultSettingsPersisted();
    chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 2 });
    await refreshServiceHealth();
    const session = await getSessionState();
    await setBadgeRecording(
      session.isCaptureRunning,
      session.recordingTabId ?? undefined,
    );
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshServiceHealth();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_ALARM) {
    void refreshServiceHealth();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "Handler error";
      sendResponse({ ok: false, error: msg });
    });
  return true;
});

/** Content script holds this port open while tab audio records — keeps MV3 SW + offscreen alive. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "mcs-audio-session") {
    console.info("[MCS:bg] audio keep-alive port connected");
    port.onDisconnect.addListener(() => {
      console.info("[MCS:bg] audio keep-alive port disconnected");
    });
  }
});

/**
 * Safety net: when the Meet tab is closed, pause the session instead of
 * finalizing it. The server-side watchdog will auto-finalize after the grace
 * period (5 min) if the user doesn't rejoin the same meeting.
 *
 * If the content script's teardown already sent INGEST_SESSION_PAUSE and
 * cleared activeCapture, this is a no-op.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const session = await getSessionState();
    if (session.recordingTabId === tabId) {
      await patchSessionState({ isCaptureRunning: false, recordingTabId: null });
    }

    if (pendingStreamId?.tabId === tabId) {
      pendingStreamId = null;
    }

    const capture = await getActiveCapture();
    if (capture?.tabId === tabId) {
      console.info(
        `[MCS:bg] Meet tab ${tabId} closed — pausing session ${capture.sessionId} (watchdog will finalize)`,
      );
      await setActiveCapture(null);
      void pauseSessionFromBackground(capture);
    }
  })();
});

void ensureDefaultSettingsPersisted().then(() => refreshServiceHealth());
