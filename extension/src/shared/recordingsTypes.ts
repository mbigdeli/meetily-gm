export type RecordingReadiness =
  | "recording"
  | "paused"
  | "finalizing"
  | "ready"
  | "audio_only"
  | "transcript_only"
  | "failed"
  | "missing";

export type TranscriptSource = "final" | "processed" | "captions" | "none";

export interface OutputFiles {
  raw: string[];
  processed: string[];
  final: string[];
}

export interface RecordingListItem {
  session_id: string;
  meeting_url?: string | null;
  meeting_code?: string | null;
  meeting_title?: string | null;
  started_at: string;
  ended_at?: string | null;
  updated_at: string;
  current_stage: string;
  overall_state: string;
  last_error?: string | null;
  readiness: RecordingReadiness;
  output_files: OutputFiles;
}

export interface RecordingsListPayload {
  limit: number;
  offset: number;
  query?: string;
  state?: string;
}

export interface RecordingsListResponse {
  items: RecordingListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecordingAudioInfo {
  session_id: string;
  available: boolean;
  relative_path?: string | null;
  mime_type?: string | null;
  byte_length: number;
  duration_sec?: number | null;
  timeline_safe: boolean;
}

export interface RecordingAudioChunk {
  session_id: string;
  offset: number;
  length: number;
  byte_length: number;
  data_base64: string;
  is_eof: boolean;
  mime_type: string;
}

export interface TranscriptSegment {
  start_sec: number;
  end_sec: number;
  speaker_name?: string | null;
  speaker_id?: string | null;
  language?: string | null;
  text: string;
}

export interface RecordingTranscript {
  session_id: string;
  source: TranscriptSource;
  readiness: RecordingReadiness;
  segments: TranscriptSegment[];
}

export interface CurrentMeetingSnapshot {
  isMeetPageActive: boolean;
  isCaptureRunning: boolean;
  isSessionPaused: boolean;
  recordingTabId: number | null;
  currentSessionId: string | null;
  currentMeetingTitle: string | null;
  currentLiveCaptionLanguage: string | null;
  localServiceStatus: string;
  lastError: string | null;
  captureRecordingAccumMs: number;
  captureRecordingSegmentStartedAt: number | null;
  activeCapture?: {
    sessionId: string;
    tabId: number;
    hasAudio: boolean;
  } | null;
  nativeStatus?: unknown;
  transcriptReadiness: RecordingReadiness | "loading" | "processing" | "none";
}
