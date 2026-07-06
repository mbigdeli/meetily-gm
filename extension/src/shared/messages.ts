import type { CaptionEventRequest, ParticipantSnapshotRequest } from "./ingestTypes.js";
import type { RecordingsListPayload } from "./recordingsTypes.js";
import type { LiveCaptionLanguage, MeetingCaptureSettings, ServiceHealthResult, SessionState } from "./types.js";

/** Canonical internal extension messages (background, popup, future content scripts). */
export type ExtensionMessage =
  | { type: "CAPTURE_START"; payload: { meetTabId?: number } }
  | { type: "CAPTURE_STOP"; payload: Record<string, never> }
  | { type: "CAPTURE_STOP_WITH_PREFETCH"; payload?: Record<string, never> }
  | { type: "FLASH_BADGE"; payload?: Record<string, never> }
  | { type: "SETTINGS_UPDATED"; payload: MeetingCaptureSettings }
  | { type: "REQUEST_SETTINGS"; payload: Record<string, never> }
  | { type: "REQUEST_SESSION_STATUS"; payload: Record<string, never> }
  | { type: "LOCAL_SERVICE_HEALTH_CHANGED"; payload: ServiceHealthResult }
  | { type: "CAPTURE_STATE_CHANGED"; payload: { isCaptureRunning: boolean } }
  | { type: "CAPTION_LANGUAGE_CHANGED"; payload: { language: LiveCaptionLanguage } }
  | { type: "EMERGENCY_STOP"; payload: Record<string, never> }
  | { type: "REQUEST_SERVICE_HEALTH"; payload: { ensureTray?: boolean } }
  | { type: "REQUEST_CURRENT_MEETING"; payload: Record<string, never> }
  | { type: "REQUEST_RECORDINGS_LIST"; payload: RecordingsListPayload }
  | { type: "REQUEST_RECORDING_TRANSCRIPT"; payload: { sessionId: string } }
  | { type: "REQUEST_RECORDING_AUDIO_INFO"; payload: { sessionId: string } }
  | {
      type: "REQUEST_RECORDING_AUDIO_CHUNK";
      payload: { sessionId: string; offset: number; length: number };
    }
  | { type: "REQUEST_ENGINE_STATUS"; payload: Record<string, never> }
  | { type: "REQUEST_CODEX_STATUS"; payload: Record<string, never> }
  | { type: "ENGINE_INSTALL"; payload: Record<string, never> }
  | { type: "ENGINE_MODEL_DOWNLOAD"; payload: { modelName: string } }
  | { type: "CODEX_LOGIN"; payload: Record<string, never> }
  | { type: "CODEX_DISCONNECT"; payload: Record<string, never> }
  | { type: "PING"; payload: Record<string, never> }
  | {
      type: "INGEST_SESSION_START";
      payload: {
        sessionId: string;
        meetingUrl: string | null;
        meetingCode: string | null;
        meetingTitle: string;
        liveCaptionLanguage: LiveCaptionLanguage | null;
      };
    }
  | {
      type: "INGEST_CAPTION_EVENT";
      payload: {
        sessionId: string;
        body: CaptionEventRequest;
      };
    }
  | {
      type: "INGEST_PARTICIPANT_SNAPSHOT";
      payload: {
        sessionId: string;
        body: ParticipantSnapshotRequest;
      };
    }
  | {
      type: "INGEST_SESSION_PAUSE";
      payload: { sessionId: string; pausedAtIso: string | null };
    }
  | {
      type: "INGEST_SESSION_END";
      payload: { sessionId: string; endedAtIso: string | null };
    }
  | { type: "AUDIO_RECORDING_START"; payload: { sessionId: string; audioSegmentIndex?: number } }
  | { type: "AUDIO_RECORDING_STOP"; payload: { sessionId: string; audioSegmentIndex?: number; keepStream?: boolean } }
  | { type: "AUDIO_ENABLE_FOR_SESSION"; payload: { sessionId: string } }
  | { type: "OPEN_OPTIONS_PAGE"; payload: Record<string, never> };

export interface SettingsAndSessionResponse {
  settings: MeetingCaptureSettings;
  session: SessionState;
  lastCaptionLanguage: LiveCaptionLanguage | null;
}
