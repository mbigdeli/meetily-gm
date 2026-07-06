import type {
  CaptionEventRequest,
  ParticipantSnapshotRequest,
  SessionPauseRequest,
  SessionStartRequest,
} from "./ingestTypes.js";
import { MEETING_CAPTURE_NATIVE_HOST, NATIVE_AUDIO_CHUNK_BYTES, nativeHostRequest, uint8ArrayToBase64 } from "./nativeHost.js";
import type {
  RecordingAudioChunk,
  RecordingAudioInfo,
  RecordingTranscript,
  RecordingsListPayload,
  RecordingsListResponse,
} from "./recordingsTypes.js";
import type { LocalServiceErrorShape, MeetingCaptureSettings, ServiceHealthResult } from "./types.js";

/** Result shape kept for UI code; `httpStatus` is synthetic (200) on native success. */
export type LocalServiceJsonResult<T = unknown> =
  | { ok: true; httpStatus: number; data: T }
  | { ok: false; httpStatus?: number; data?: unknown; error: string };

export function normalizeLocalServiceError(err: unknown, httpStatus?: number): LocalServiceErrorShape {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "timeout", message: "Request timed out" };
  }
  if (err instanceof TypeError) {
    return { kind: "network", message: err.message || "Network error" };
  }
  if (typeof err === "object" && err !== null && "message" in err && typeof (err as Error).message === "string") {
    return { kind: "unknown", message: (err as Error).message };
  }
  return { kind: "unknown", message: "Unknown error", httpStatus };
}

/**
 * Interprets health payload from `health.check` (and legacy HTTP shapes).
 * Accepts `{ ok: true }`, `{ status: "ok" }`, or empty JSON object.
 */
export function isHealthyBody(json: unknown): boolean {
  if (json === null || json === undefined) {
    return true;
  }
  if (typeof json !== "object") {
    return false;
  }
  const o = json as Record<string, unknown>;
  if (o.ok === true) {
    return true;
  }
  if (o.status === "ok" || o.status === "healthy") {
    return true;
  }
  if (Object.keys(o).length === 0) {
    return true;
  }
  return false;
}

async function nativeJson<T>(
  settings: MeetingCaptureSettings,
  action: string,
  payload: Record<string, unknown>,
): Promise<LocalServiceJsonResult<T>> {
  const r = await nativeHostRequest(settings.localServiceTimeoutMs, action, payload);
  if (r.ok) {
    return { ok: true, httpStatus: 200, data: r.data as T };
  }
  return { ok: false, error: r.error };
}

export async function checkLocalServiceHealth(
  settings: MeetingCaptureSettings,
  options: { ensureTray?: boolean } = {},
): Promise<ServiceHealthResult> {
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  const payload = options.ensureTray === true ? { ensure_tray: true } : {};
  const r = await nativeHostRequest(settings.localServiceTimeoutMs, "health.check", payload);
  const latencyMs = Math.round(performance.now() - started);

  if (!r.ok) {
    if (r.error.includes("timed out")) {
      return { status: "timeout", checkedAt, detail: r.error, latencyMs };
    }
    if (
      r.error.includes("not found") ||
      r.error.includes("disconnect") ||
      r.error.includes("Specified native messaging host") ||
      r.error.includes("Access to the specified native messaging host")
    ) {
      return {
        status: "unavailable",
        checkedAt,
        detail: `${r.error} Install the host and register ${MEETING_CAPTURE_NATIVE_HOST} (see install.ps1).`,
        latencyMs,
      };
    }
    return { status: "error", checkedAt, detail: r.error, latencyMs };
  }

  if (!isHealthyBody(r.data)) {
    return {
      status: "unhealthy",
      checkedAt,
      latencyMs,
      httpStatus: 200,
      detail: "Health payload did not indicate OK",
    };
  }

  const trayStatus = interpretTrayStatus(r.data, options.ensureTray === true);

  return {
    status: trayStatus.status,
    checkedAt,
    latencyMs,
    httpStatus: 200,
    detail: trayStatus.detail,
  };
}

function interpretTrayStatus(
  data: unknown,
  ensureTray: boolean,
): { status: ServiceHealthResult["status"]; detail?: string } {
  if (!data || typeof data !== "object") {
    return { status: "connected" };
  }

  const record = data as Record<string, unknown>;
  const tray = record.tray;
  const ensure = record.tray_ensure;

  if (tray && typeof tray === "object") {
    const trayRecord = tray as Record<string, unknown>;
    if (trayRecord.running === true) {
      return { status: "connected", detail: stringField(trayRecord, "detail") };
    }

    if (ensureTray && ensure && typeof ensure === "object") {
      const ensureRecord = ensure as Record<string, unknown>;
      if (ensureRecord.started === true) {
        return { status: "tray_starting", detail: "Desktop tray app is starting." };
      }
      const error = stringField(ensureRecord, "error");
      if (error) {
        return { status: "error", detail: error };
      }
    }

    const nested = trayRecord.status;
    if (nested && typeof nested === "object") {
      const statusRecord = nested as Record<string, unknown>;
      if (statusRecord.state === "stopped" && statusRecord.last_exit_reason === "user_quit") {
        return { status: "tray_stopped", detail: "Desktop tray app was stopped by the user." };
      }
    }
    return { status: "tray_stopped", detail: stringField(trayRecord, "detail") ?? "Desktop tray app is not running." };
  }

  return { status: "connected" };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Sends tab audio to the native host in chunks (Native Messaging frame size limit).
 */
export async function postSessionAudioNative(
  settings: MeetingCaptureSettings,
  sessionId: string,
  blob: Blob,
  segmentIndex: number | null,
): Promise<LocalServiceJsonResult> {
  const contentType = blob.type && blob.type.length > 0 ? blob.type : "audio/webm";
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);

  if (u8.length === 0) {
    return { ok: true, httpStatus: 200, data: { status: "ok", bytes: 0 } };
  }

  let offset = 0;
  let chunkIndex = 0;

  while (offset < u8.length) {
    const end = Math.min(offset + NATIVE_AUDIO_CHUNK_BYTES, u8.length);
    const slice = u8.subarray(offset, end);
    const dataBase64 = uint8ArrayToBase64(slice);
    const isLastChunk = end >= u8.length;

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

    const r = await nativeHostRequest(settings.localServiceTimeoutMs, "session.audio", payload);
    if (!r.ok) {
      return { ok: false, error: r.error };
    }

    offset = end;
    chunkIndex += 1;
  }

  return { ok: true, httpStatus: 200, data: { status: "ok" } };
}

/**
 * Canonical client: all calls go through Chrome Native Messaging to `meeting-capture`.
 */
export class LocalServiceClient {
  constructor(private readonly getSettings: () => Promise<MeetingCaptureSettings>) {}

  async checkHealth(options: { ensureTray?: boolean } = {}): Promise<ServiceHealthResult> {
    const settings = await this.getSettings();
    return checkLocalServiceHealth(settings, options);
  }

  async getEngineStatus(): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "engine.status", {});
  }

  async postEngineInstall(): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "engine.install", {});
  }

  async postEngineModelDownload(modelName: string): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "engine.download", { model: modelName });
  }

  async getCodexStatus(): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "codex.status", {});
  }

  async postCodexLoginStart(): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const payload: Record<string, unknown> = {};
    if (typeof chrome !== "undefined" && typeof chrome.runtime?.id === "string" && chrome.runtime.id.length > 0) {
      payload.extension_id = chrome.runtime.id;
    }
    return nativeJson(settings, "codex.login_start", payload);
  }

  async postCodexDisconnect(): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "codex.disconnect", {});
  }

  async postCodexResetLogin(): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "codex.reset_login", {});
  }

  async postSessionStart(body: SessionStartRequest): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const payload = { ...body } as unknown as Record<string, unknown>;
    return nativeJson(settings, "session.start", payload);
  }

  async postCaptionEvent(sessionId: string, body: CaptionEventRequest): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const payload = { session_id: sessionId, ...(body as unknown as Record<string, unknown>) };
    return nativeJson(settings, "session.caption", payload);
  }

  async postParticipantSnapshot(sessionId: string, body: ParticipantSnapshotRequest): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const payload = { session_id: sessionId, ...(body as unknown as Record<string, unknown>) };
    return nativeJson(settings, "session.participants", payload);
  }

  async postSessionAudio(sessionId: string, blob: Blob): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return postSessionAudioNative(settings, sessionId, blob, null);
  }

  async postSessionPause(sessionId: string, pausedAtIso: string | null): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const body: SessionPauseRequest = { paused_at: pausedAtIso };
    return nativeJson(settings, "session.pause", {
      session_id: sessionId,
      ...(body as unknown as Record<string, unknown>),
    });
  }

  async postSessionEnd(sessionId: string, endedAtIso: string | null): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const payload: Record<string, unknown> = { session_id: sessionId };
    if (endedAtIso !== null) {
      payload.ended_at = endedAtIso;
    }
    return nativeJson(settings, "session.end", payload);
  }

  async getSessionStatus(sessionId: string): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    return nativeJson(settings, "session.status", { session_id: sessionId });
  }

  async postSessionReprocess(
    sessionId: string,
    fromStage: string,
    codexMergeEnabled?: boolean,
  ): Promise<LocalServiceJsonResult> {
    const settings = await this.getSettings();
    const payload: Record<string, unknown> = { session_id: sessionId, from_stage: fromStage };
    if (typeof codexMergeEnabled === "boolean") {
      payload.codex_merge_enabled = codexMergeEnabled;
    }
    return nativeJson(settings, "session.reprocess", payload);
  }

  async listRecordings(payload: RecordingsListPayload): Promise<LocalServiceJsonResult<RecordingsListResponse>> {
    const settings = await this.getSettings();
    return nativeJson(settings, "sessions.list", {
      limit: payload.limit,
      offset: payload.offset,
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.state ? { state: payload.state } : {}),
    });
  }

  async getRecordingAudioInfo(sessionId: string): Promise<LocalServiceJsonResult<RecordingAudioInfo>> {
    const settings = await this.getSettings();
    return nativeJson(settings, "session.recording.info", { session_id: sessionId });
  }

  async getRecordingAudioChunk(
    sessionId: string,
    offset: number,
    length: number,
  ): Promise<LocalServiceJsonResult<RecordingAudioChunk>> {
    const settings = await this.getSettings();
    return nativeJson(settings, "session.recording.chunk", {
      session_id: sessionId,
      offset,
      length,
    });
  }

  async getRecordingTranscript(sessionId: string): Promise<LocalServiceJsonResult<RecordingTranscript>> {
    const settings = await this.getSettings();
    return nativeJson(settings, "session.transcript", { session_id: sessionId });
  }
}
