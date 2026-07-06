import type { SessionStartRequest } from "../shared/ingestTypes.js";
import type { MeetingCaptureSettings } from "../shared/types.js";

const CANONICAL_WHISPER_MODELS = new Set(["tiny", "base", "small", "medium", "large"]);

export interface BuildWhisperTestSessionInput {
  settings: MeetingCaptureSettings;
  sessionId: string;
  startedAtIso: string;
  extensionVersion: string | null;
  meetingTitle: string;
  codexMergeEnabled: boolean;
}

export interface RelatedReference {
  path: string;
  symbols: string[];
  note: string;
}

export function whisperModelFilename(modelName: string): string | null {
  const normalized = modelName.trim().toLowerCase();
  return CANONICAL_WHISPER_MODELS.has(normalized) ? `ggml-${normalized}.bin` : null;
}

export function buildWhisperTestSessionStart(input: BuildWhisperTestSessionInput): SessionStartRequest {
  const meetingTitle = input.meetingTitle.trim() || "Whisper Voice Test";
  return {
    session_id: input.sessionId,
    meeting_url: null,
    meeting_code: null,
    meeting_title: meetingTitle,
    started_at: input.startedAtIso,
    live_caption_language: null,
    extension_version: input.extensionVersion,
    raw_root_path: input.settings.rawStorageRoot.trim(),
    final_root_path: input.settings.finalOutputRoot.trim(),
    codex_merge_enabled: input.codexMergeEnabled,
    whisper_model_filename: whisperModelFilename(input.settings.whisperPreferredModel),
  };
}

export const WHISPER_TEST_REFERENCES: RelatedReference[] = [
  {
    path: "src/extension/src/whisper-test/main.ts",
    symbols: ["startVoiceTest", "stopAndRunWhisperTest", "pollSessionStatus"],
    note: "Temporary extension page that records microphone audio and drives the native session.",
  },
  {
    path: "src/extension/src/shared/localServiceClient.ts",
    symbols: ["LocalServiceClient.postSessionStart", "LocalServiceClient.postSessionAudio", "LocalServiceClient.postSessionEnd", "LocalServiceClient.getSessionStatus"],
    note: "Chrome Native Messaging client used by the test page.",
  },
  {
    path: "src/local-service-rs/src/handlers/sessions.rs",
    symbols: ["handle_start", "handle_audio", "handle_end", "handle_status"],
    note: "Native host session actions that write raw audio and expose pipeline status.",
  },
  {
    path: "src/local-service-rs/src/pipeline/runner.rs",
    symbols: ["spawn_session_pipeline", "run_pipeline"],
    note: "Pipeline runner that prepares audio and invokes Whisper after session end.",
  },
  {
    path: "src/local-service-rs/src/pipeline/transcribe.rs",
    symbols: ["transcribe_to_file", "transcribe_chunks_to_file"],
    note: "Whisper transcription implementation and transcript artifact writer.",
  },
];
