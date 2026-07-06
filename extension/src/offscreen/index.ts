/**
 * Offscreen document: holds tab-capture MediaRecorder, uploads the final
 * WebM blob via the service worker + Chrome Native Messaging (chunked base64).
 */

import { recordMediaChunk, resetRecordingStats } from "./stats.js";
import { uploadAudioViaNativeChunks, type SegmentUploadMeta } from "./uploadNativeChunks.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let loopbackCtx: AudioContext | null = null;
let micMediaStream: MediaStream | null = null;
let mixerCtx: AudioContext | null = null;
let recordingStream: MediaStream | null = null;
const chunks: Blob[] = [];

const ROLLING_CHUNK_MS = 30_000;
const ROLLING_OVERLAP_MS = 5_000;
const ROLLING_STRIDE_MS = ROLLING_CHUNK_MS - ROLLING_OVERLAP_MS;

interface RollingSegment {
  index: number;
  startedAtMs: number;
  recorder: MediaRecorder;
  chunks: Blob[];
  stopTimer: ReturnType<typeof setTimeout>;
  uploadPromise?: Promise<void>;
  stopping: boolean;
}

interface RollingSession {
  sessionId: string;
  initialSegmentIndex: number;
  nextSegmentIndex: number;
  sessionStartedAtMs: number;
  stream: MediaStream;
  active: Map<number, RollingSegment>;
  uploads: Promise<void>[];
  strideTimer: ReturnType<typeof setInterval>;
  stopped: boolean;
}

let rollingSession: RollingSession | null = null;

/**
 * Serialization queue for start/stop operations.  Prevents concurrent
 * startRecording / stopRecordingAndBlob from clobbering shared module-level
 * media state (mediaRecorder, mediaStream, loopbackCtx, etc.).
 */
let opQueue: Promise<unknown> = Promise.resolve();

function queueOp<T>(fn: () => Promise<T>): Promise<T> {
  const p = opQueue.then(fn, fn);
  opQueue = p.then(() => undefined, () => undefined);
  return p;
}

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return undefined;
}

function hasLiveStream(): boolean {
  return mediaStream !== null && mediaStream.getTracks().some((t) => t.readyState === "live");
}

function createAndStartRecorder(stream: MediaStream): void {
  chunks.length = 0;
  const mime = pickMimeType();
  mediaRecorder = mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
      recordMediaChunk(ev.data.size);
    }
  };
  mediaRecorder.start(1000);
}

function createRecorder(stream: MediaStream): MediaRecorder {
  const mime = pickMimeType();
  return mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);
}

function uploadRollingSegment(
  session: RollingSession,
  segment: RollingSegment,
  isFinal: boolean,
): Promise<void> {
  const endedAtMs = Date.now();
  const mime = segment.recorder.mimeType || "audio/webm";
  const blob = new Blob(segment.chunks, { type: mime });
  segment.chunks.length = 0;
  session.active.delete(segment.index);

  if (blob.size === 0) {
    return Promise.resolve();
  }

  const meta: SegmentUploadMeta = {
    segmentStartedAt: new Date(segment.startedAtMs).toISOString(),
    segmentEndedAt: new Date(endedAtMs).toISOString(),
    sessionStartOffsetSec: Math.max(0, (segment.startedAtMs - session.sessionStartedAtMs) / 1000),
    durationSec: Math.max(0, (endedAtMs - segment.startedAtMs) / 1000),
    overlapPrevSec: segment.index === session.initialSegmentIndex ? 0 : ROLLING_OVERLAP_MS / 1000,
    overlapNextSec: isFinal ? 0 : ROLLING_OVERLAP_MS / 1000,
  };

  return uploadAudioViaNativeChunks(session.sessionId, blob, segment.index, meta).then((result) => {
    if (!result.ok) {
      throw new Error(result.error ?? "rolling_segment_upload_failed");
    }
  });
}

function stopRollingSegment(
  session: RollingSession,
  segment: RollingSegment,
  isFinal: boolean,
): Promise<void> {
  if (segment.uploadPromise) {
    return segment.uploadPromise;
  }
  segment.stopping = true;
  clearTimeout(segment.stopTimer);

  const rec = segment.recorder;
  if (rec.state === "inactive") {
    segment.uploadPromise = uploadRollingSegment(session, segment, isFinal);
    return segment.uploadPromise;
  }

  segment.uploadPromise = new Promise<void>((resolve, reject) => {
    rec.addEventListener(
      "stop",
      () => {
        uploadRollingSegment(session, segment, isFinal).then(resolve, reject);
      },
      { once: true },
    );
    try { rec.requestData?.(); } catch { /* optional */ }
    try {
      rec.stop();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

  return segment.uploadPromise;
}

function startRollingSegment(session: RollingSession): void {
  if (session.stopped) {
    return;
  }
  const recorder = createRecorder(session.stream);
  const segment: RollingSegment = {
    index: session.nextSegmentIndex,
    startedAtMs: Date.now(),
    recorder,
    chunks: [],
    stopTimer: setTimeout(() => undefined, 0),
    stopping: false,
  };
  clearTimeout(segment.stopTimer);
  session.nextSegmentIndex += 1;
  session.active.set(segment.index, segment);

  recorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) {
      segment.chunks.push(ev.data);
      recordMediaChunk(ev.data.size);
    }
  };
  recorder.onerror = (ev) => {
    console.error(`[MCS:offscreen] rolling recorder ${segment.index} error:`, ev);
  };
  segment.stopTimer = setTimeout(() => {
    const upload = stopRollingSegment(session, segment, false).catch((e: unknown) => {
      console.error(`[MCS:offscreen] rolling segment ${segment.index} upload failed: ${e instanceof Error ? e.message : e}`);
    });
    session.uploads.push(upload);
  }, ROLLING_CHUNK_MS);
  recorder.start(1000);
  console.info(`[MCS:offscreen] rolling segment ${segment.index} started`);
}

function startRollingRecording(sessionId: string, initialSegmentIndex: number, stream: MediaStream): void {
  if (rollingSession) {
    rollingSession.stopped = true;
    clearInterval(rollingSession.strideTimer);
  }
  const session: RollingSession = {
    sessionId,
    initialSegmentIndex,
    nextSegmentIndex: initialSegmentIndex,
    sessionStartedAtMs: Date.now(),
    stream,
    active: new Map(),
    uploads: [],
    strideTimer: setInterval(() => {
      if (rollingSession === session) {
        startRollingSegment(session);
      }
    }, ROLLING_STRIDE_MS),
    stopped: false,
  };
  rollingSession = session;
  startRollingSegment(session);
}

async function stopRollingRecording(keepStream: boolean): Promise<{ uploaded: boolean; error?: string; nextSegmentIndex?: number }> {
  const session = rollingSession;
  if (!session) {
    return { uploaded: false, error: "not_recording" };
  }
  session.stopped = true;
  clearInterval(session.strideTimer);

  const stops = Array.from(session.active.values()).map((segment) =>
    stopRollingSegment(session, segment, true),
  );
  try {
    await Promise.all(stops);
    await Promise.all(session.uploads);
  } catch (e) {
    return { uploaded: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    rollingSession = null;
    if (!keepStream) {
      stopRecordingSync();
    }
  }
  return { uploaded: true, nextSegmentIndex: session.nextSegmentIndex };
}

async function startRecording(
  streamId: string,
  recordMic = false,
  sessionId = "",
  initialSegmentIndex = 0,
): Promise<void> {
  if (hasLiveStream() && recordingStream) {
    console.info("[MCS:offscreen] reusing existing live stream for new recording ✓");
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch { /* ignore */ }
    }
    mediaRecorder = null;
    resetRecordingStats();
    if (sessionId) {
      startRollingRecording(sessionId, initialSegmentIndex, recordingStream);
    } else {
      createAndStartRecorder(recordingStream);
    }
    console.info("[MCS:offscreen] MediaRecorder started (reused stream) ✓");
    return;
  }

  stopRecordingSync();
  resetRecordingStats();
  const constraints: MediaStreamConstraints = {
    audio: {
      // @ts-expect-error Chrome tab capture
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  };
  const tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  mediaStream = tabStream;

  try {
    loopbackCtx = new AudioContext();
    const src = loopbackCtx.createMediaStreamSource(tabStream);
    src.connect(loopbackCtx.destination);
    console.info("[MCS:offscreen] audio loopback active — tab audio audible ✓");
  } catch (e) {
    console.warn("[MCS:offscreen] loopback setup failed, tab audio may be muted:", e);
  }

  let streamToRecord: MediaStream = tabStream;
  if (recordMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      micMediaStream = micStream;
      mixerCtx = new AudioContext();
      const mixedDest = mixerCtx.createMediaStreamDestination();
      mixerCtx.createMediaStreamSource(tabStream).connect(mixedDest);
      mixerCtx.createMediaStreamSource(micStream).connect(mixedDest);
      streamToRecord = mixedDest.stream;
      console.info("[MCS:offscreen] mic mixed with tab audio ✓");
    } catch (e) {
      console.warn("[MCS:offscreen] mic capture failed, recording tab audio only:", e);
    }
  }

  recordingStream = streamToRecord;
  if (sessionId) {
    startRollingRecording(sessionId, initialSegmentIndex, streamToRecord);
  } else {
    createAndStartRecorder(streamToRecord);
  }
  console.info("[MCS:offscreen] MediaRecorder started (new stream) ✓");
}

function stopRecordingSync(): void {
  if (rollingSession) {
    rollingSession.stopped = true;
    clearInterval(rollingSession.strideTimer);
    for (const segment of rollingSession.active.values()) {
      clearTimeout(segment.stopTimer);
      if (segment.recorder.state !== "inactive") {
        try { segment.recorder.stop(); } catch { /* ignore */ }
      }
    }
    rollingSession = null;
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch { /* ignore */ }
  }
  mediaRecorder = null;
  recordingStream = null;
  if (mixerCtx) {
    void mixerCtx.close().catch(() => undefined);
    mixerCtx = null;
  }
  if (micMediaStream) {
    for (const t of micMediaStream.getTracks()) t.stop();
    micMediaStream = null;
  }
  if (loopbackCtx) {
    void loopbackCtx.close().catch(() => undefined);
    loopbackCtx = null;
  }
  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
    mediaStream = null;
  }
}

/**
 * Stops the MediaRecorder and collects its blob, but keeps the underlying
 * mediaStream, loopback, mixer, and mic streams alive so a subsequent
 * startRecording() can reuse them without re-acquiring tab capture.
 */
async function pauseRecordingAndBlob(): Promise<Blob> {
  const rec = mediaRecorder;
  const mime = rec?.mimeType ?? "audio/webm";
  if (!rec || rec.state === "inactive") {
    mediaRecorder = null;
    return new Blob(chunks.splice(0), { type: mime });
  }
  const done = new Promise<void>((resolve) => {
    rec.addEventListener("stop", () => resolve(), { once: true });
  });
  try { rec.requestData?.(); } catch { /* optional */ }
  rec.stop();
  await done;
  mediaRecorder = null;
  const blob = new Blob(chunks, { type: mime });
  chunks.length = 0;
  console.info("[MCS:offscreen] recording paused — stream kept alive ✓");
  return blob;
}

/** Full stop: collects blob AND releases all media resources. */
async function stopRecordingAndBlob(): Promise<Blob> {
  const rec = mediaRecorder;
  const mime = rec?.mimeType ?? "audio/webm";
  if (!rec || rec.state === "inactive") {
    stopRecordingSync();
    return new Blob([], { type: mime });
  }
  const done = new Promise<void>((resolve) => {
    rec.addEventListener("stop", () => resolve(), { once: true });
  });
  try { rec.requestData?.(); } catch { /* optional */ }
  rec.stop();
  await done;
  mediaRecorder = null;
  recordingStream = null;
  if (mixerCtx) {
    void mixerCtx.close().catch(() => undefined);
    mixerCtx = null;
  }
  if (micMediaStream) {
    for (const t of micMediaStream.getTracks()) t.stop();
    micMediaStream = null;
  }
  if (loopbackCtx) {
    void loopbackCtx.close().catch(() => undefined);
    loopbackCtx = null;
  }
  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
    mediaStream = null;
  }
  const blob = new Blob(chunks, { type: mime });
  chunks.length = 0;
  return blob;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRecord(message) || typeof message.type !== "string") return;

  if (message.type === "OFFSCREEN_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "OFFSCREEN_RECORD_START") {
    const streamId = typeof message.streamId === "string" ? message.streamId : "";
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
    const initialSegmentIndex = typeof message.initialSegmentIndex === "number" ? message.initialSegmentIndex : 0;
    if (!streamId && !hasLiveStream()) {
      sendResponse({ ok: false, error: "missing_stream_id" });
      return false;
    }
    const recordMic = typeof message.recordMic === "boolean" ? message.recordMic : false;
    const label = streamId ? streamId.slice(0, 12) + "…" : "existing-stream";
    console.info(`[MCS:offscreen] starting recording for ${label} (mic=${recordMic})`);
    void queueOp(() => startRecording(streamId, recordMic, sessionId, initialSegmentIndex))
      .then(() => sendResponse({ ok: true, hasStream: true }))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[MCS:offscreen] start failed: ${msg}`);
        sendResponse({ ok: false, error: msg });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_RECORD_STOP") {
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
    const segmentIndex = typeof message.segmentIndex === "number" ? message.segmentIndex : null;
    const keepStream = message.keepStream === true;
    console.info(`[MCS:offscreen] stopping recording (session=${sessionId}, segment=${segmentIndex}, keepStream=${keepStream})…`);
    if (rollingSession) {
      void queueOp(() => stopRollingRecording(keepStream))
        .then((result) => sendResponse({
          ok: true,
          uploaded: result.uploaded,
          error: result.error,
          nextSegmentIndex: result.nextSegmentIndex,
        }))
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[MCS:offscreen] rolling stop failed: ${msg}`);
          sendResponse({ ok: false, error: msg });
        });
      return true;
    }
    const stopFn = keepStream ? pauseRecordingAndBlob : stopRecordingAndBlob;
    void queueOp(() =>
      stopFn().then(async (blob) => {
        console.info(`[MCS:offscreen] blob: ${blob.size} bytes`);
        if (blob.size === 0) {
          sendResponse({ ok: true, uploaded: false, reason: "empty_blob" });
          return;
        }
        if (!sessionId) {
          console.error("[MCS:offscreen] missing sessionId — cannot upload");
          sendResponse({ ok: true, uploaded: false, reason: "missing_params" });
          return;
        }
        const result = await uploadAudioViaNativeChunks(sessionId, blob, segmentIndex);
        sendResponse({ ok: true, uploaded: result.ok, error: result.error });
      }),
    ).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MCS:offscreen] stop failed: ${msg}`);
      sendResponse({ ok: false, error: msg });
    });
    return true;
  }

  return false;
});
