/** JSON bodies aligned with `src/local-service/app/schemas.py` (browser → localhost). */

export interface SessionStartRequest {
  session_id: string;
  meeting_url: string | null;
  meeting_code: string | null;
  meeting_title: string;
  started_at: string;
  live_caption_language: string | null;
  extension_version: string | null;
  raw_root_path: string;
  final_root_path: string;
  /** When false, local service skips Codex merge for this session. Default true. */
  codex_merge_enabled?: boolean;
  /** Optional `ggml-*.bin` filename under the Whisper models directory. */
  whisper_model_filename?: string | null;
}

export interface CaptionEventRequest {
  captured_at: string;
  sequence_number: number;
  caption_text: string;
  speaker_hint_text: string | null;
  source_language_setting: string | null;
  start_offset_sec?: number | null;
  end_offset_sec?: number | null;
  dom_signature?: string | null;
}

export interface ParticipantItemRequest {
  display_name: string;
  normalized_name?: string | null;
  is_self?: boolean | null;
  ui_source?: string | null;
  confidence?: number | null;
}

export interface ParticipantSnapshotRequest {
  captured_at: string;
  participants: ParticipantItemRequest[];
}

export interface SessionPauseRequest {
  paused_at: string | null;
}
