/** Live caption language for Google Meet (Layer A). */
export type LiveCaptionLanguage = "fa" | "en";

export type LocalServiceConnectionStatus =
  | "unknown"
  | "connected"
  | "tray_starting"
  | "tray_stopped"
  | "unhealthy"
  | "unavailable"
  | "timeout"
  | "error";

export interface ServiceHealthResult {
  status: LocalServiceConnectionStatus;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  detail?: string;
}

export type WhisperDevicePreference = "auto" | "cpu" | "cuda";

export type WhisperComputeType = "auto" | "int8" | "float16" | "float32";

export interface MeetingCaptureSettings {
  /** Base URL for the local service, e.g. http://127.0.0.1:17380 */
  localServiceBaseUrl: string;
  /** Request timeout for localhost calls in milliseconds. */
  localServiceTimeoutMs: number;

  /** Absolute or Windows path; required before capture (validated on save in Options). */
  rawStorageRoot: string;
  finalOutputRoot: string;
  keepRawFilesAfterProcessing: boolean;
  autoOpenFinalOutputFolder: boolean;

  autoStartCaptureWhenMeetDetected: boolean;
  autoEnableLiveCaptions: boolean;
  hideCaptionOverlayWhileParsing: boolean;
  autoRecordTabAudio: boolean;

  whisperPreferredModel: string;
  whisperDevicePreference: WhisperDevicePreference;
  whisperComputeType: WhisperComputeType;

  diarizationEnabled: boolean;
  /** Optional hint for diarization; null if unset. */
  diarizationSpeakerCountHint: number | null;

  codexMergeEnabled: boolean;
  codexGenerateSummary: boolean;
  codexGenerateActionItems: boolean;
  codexGenerateDecisions: boolean;
}

export interface SessionState {
  isMeetPageActive: boolean;
  isCaptureRunning: boolean;
  isSessionPaused: boolean;
  recordingTabId: number | null;
  currentSessionId: string | null;
  currentMeetingTitle: string | null;
  currentLiveCaptionLanguage: LiveCaptionLanguage | null;
  localServiceStatus: LocalServiceConnectionStatus;
  lastError: string | null;
  /** Sum of completed active-recording segments (ms), excluding paused time. */
  captureRecordingAccumMs: number;
  /** Wall time when the current recording segment started; null while not recording. */
  captureRecordingSegmentStartedAt: number | null;
}

export const DEFAULT_SETTINGS: MeetingCaptureSettings = {
  localServiceBaseUrl: "http://127.0.0.1:17380",
  localServiceTimeoutMs: 5000,
  rawStorageRoot: "D:\\Meet\\Raw",
  finalOutputRoot: "D:\\Meet\\Final",
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

export const DEFAULT_SESSION_STATE: SessionState = {
  isMeetPageActive: false,
  isCaptureRunning: false,
  isSessionPaused: false,
  recordingTabId: null,
  currentSessionId: null,
  currentMeetingTitle: null,
  currentLiveCaptionLanguage: null,
  localServiceStatus: "unknown",
  lastError: null,
  captureRecordingAccumMs: 0,
  captureRecordingSegmentStartedAt: null,
};

export interface LocalServiceErrorShape {
  kind: "network" | "timeout" | "http" | "parse" | "unknown";
  message: string;
  httpStatus?: number;
}

/** Persisted in chrome.storage.local to track segment numbering across pauses. */
export interface CaptureSegmentState {
  sessionId: string;
  meetingCode: string;
  seq: number;
  audioSegmentIndex: number;
}
