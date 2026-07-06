import { z } from "zod";
import type { LiveCaptionLanguage } from "./types.js";

export const liveCaptionLanguageSchema: z.ZodType<LiveCaptionLanguage> = z.union([
  z.literal("fa"),
  z.literal("en"),
]);

const whisperDevicePreferenceSchema = z.enum(["auto", "cpu", "cuda"]);
const whisperComputeTypeSchema = z.enum(["auto", "int8", "float16", "float32"]);

export const meetingCaptureSettingsSchema = z.object({
  localServiceBaseUrl: z.string().url(),
  localServiceTimeoutMs: z.number().int().min(500).max(120_000),
  rawStorageRoot: z.string().max(4096).default("D:\\Meet\\Raw"),
  finalOutputRoot: z.string().max(4096).default("D:\\Meet\\Final"),
  keepRawFilesAfterProcessing: z.boolean().default(true),
  autoOpenFinalOutputFolder: z.boolean().default(false),
  autoStartCaptureWhenMeetDetected: z.boolean().default(false),
  autoEnableLiveCaptions: z.boolean().default(true),
  hideCaptionOverlayWhileParsing: z.boolean().default(false),
  autoRecordTabAudio: z.boolean().default(true),
  whisperPreferredModel: z.string().trim().min(1).max(128).default("base"),
  whisperDevicePreference: whisperDevicePreferenceSchema.default("auto"),
  whisperComputeType: whisperComputeTypeSchema.default("auto"),
  diarizationEnabled: z.boolean().default(true),
  diarizationSpeakerCountHint: z
    .number()
    .int()
    .min(1)
    .max(32)
    .nullable()
    .default(null),
  codexMergeEnabled: z.boolean().default(true),
  codexGenerateSummary: z.boolean().default(true),
  codexGenerateActionItems: z.boolean().default(true),
  codexGenerateDecisions: z.boolean().default(true),
});

export const sessionStateSchema = z.object({
  isMeetPageActive: z.boolean(),
  isCaptureRunning: z.boolean(),
  isSessionPaused: z.boolean().optional().default(false),
  recordingTabId: z.number().int().nullable().optional().default(null),
  currentSessionId: z.string().min(1).nullable(),
  currentMeetingTitle: z.string().nullable(),
  currentLiveCaptionLanguage: liveCaptionLanguageSchema.nullable(),
  localServiceStatus: z.enum([
    "unknown",
    "connected",
    "tray_starting",
    "tray_stopped",
    "unhealthy",
    "unavailable",
    "timeout",
    "error",
  ]),
  lastError: z.string().nullable(),
  captureRecordingAccumMs: z.number().int().nonnegative().optional().default(0),
  captureRecordingSegmentStartedAt: z.number().int().nonnegative().nullable().optional().default(null),
});

export const serviceHealthResultSchema = z.object({
  status: z.enum([
    "unknown",
    "connected",
    "tray_starting",
    "tray_stopped",
    "unhealthy",
    "unavailable",
    "timeout",
    "error",
  ]),
  checkedAt: z.string(),
  latencyMs: z.number().optional(),
  httpStatus: z.number().optional(),
  detail: z.string().optional(),
});

const emptyPayload = z.object({}).strict();
const sessionIdPayload = z.object({ sessionId: z.string().min(1).max(256) }).strict();

export const extensionMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CAPTURE_START"),
    payload: z.object({ meetTabId: z.number().int().nonnegative().optional() }).strict(),
  }),
  z.object({ type: z.literal("CAPTURE_STOP"), payload: emptyPayload }),
  z.object({ type: z.literal("CAPTURE_STOP_WITH_PREFETCH"), payload: emptyPayload.optional() }),
  z.object({ type: z.literal("FLASH_BADGE"), payload: emptyPayload.optional() }),
  z.object({ type: z.literal("SETTINGS_UPDATED"), payload: meetingCaptureSettingsSchema }),
  z.object({ type: z.literal("REQUEST_SETTINGS"), payload: emptyPayload }),
  z.object({ type: z.literal("REQUEST_SESSION_STATUS"), payload: emptyPayload }),
  z.object({
    type: z.literal("LOCAL_SERVICE_HEALTH_CHANGED"),
    payload: serviceHealthResultSchema,
  }),
  z.object({
    type: z.literal("CAPTURE_STATE_CHANGED"),
    payload: z.object({ isCaptureRunning: z.boolean() }),
  }),
  z.object({
    type: z.literal("CAPTION_LANGUAGE_CHANGED"),
    payload: z.object({ language: liveCaptionLanguageSchema }),
  }),
  z.object({ type: z.literal("EMERGENCY_STOP"), payload: emptyPayload }),
  z.object({
    type: z.literal("REQUEST_SERVICE_HEALTH"),
    payload: z.object({ ensureTray: z.boolean().optional() }).strict(),
  }),
  z.object({ type: z.literal("REQUEST_CURRENT_MEETING"), payload: emptyPayload }),
  z.object({
    type: z.literal("REQUEST_RECORDINGS_LIST"),
    payload: z.object({
      limit: z.number().int().min(1).max(100),
      offset: z.number().int().min(0),
      query: z.string().max(256).optional(),
      state: z.string().max(64).optional(),
    }).strict(),
  }),
  z.object({ type: z.literal("REQUEST_RECORDING_TRANSCRIPT"), payload: sessionIdPayload }),
  z.object({ type: z.literal("REQUEST_RECORDING_AUDIO_INFO"), payload: sessionIdPayload }),
  z.object({
    type: z.literal("REQUEST_RECORDING_AUDIO_CHUNK"),
    payload: z.object({
      sessionId: z.string().min(1).max(256),
      offset: z.number().int().min(0),
      length: z.number().int().min(1).max(360 * 1024),
    }).strict(),
  }),
  z.object({ type: z.literal("REQUEST_ENGINE_STATUS"), payload: emptyPayload }),
  z.object({ type: z.literal("REQUEST_CODEX_STATUS"), payload: emptyPayload }),
  z.object({ type: z.literal("ENGINE_INSTALL"), payload: emptyPayload }),
  z.object({
    type: z.literal("ENGINE_MODEL_DOWNLOAD"),
    payload: z.object({ modelName: z.string().min(1).max(128) }),
  }),
  z.object({ type: z.literal("CODEX_LOGIN"), payload: emptyPayload }),
  z.object({ type: z.literal("CODEX_DISCONNECT"), payload: emptyPayload }),
  z.object({ type: z.literal("PING"), payload: emptyPayload }),
  z.object({
    type: z.literal("INGEST_SESSION_START"),
    payload: z.object({
      sessionId: z.string().min(1).max(256),
      meetingUrl: z.string().nullable(),
      meetingCode: z.string().nullable(),
      meetingTitle: z.string(),
      liveCaptionLanguage: liveCaptionLanguageSchema.nullable(),
    }),
  }),
  z.object({
    type: z.literal("INGEST_CAPTION_EVENT"),
    payload: z.object({
      sessionId: z.string().min(1),
      body: z.object({
        captured_at: z.string(),
        sequence_number: z.number().int().min(0),
        caption_text: z.string(),
        speaker_hint_text: z.string().nullable(),
        source_language_setting: z.string().nullable(),
        start_offset_sec: z.number().nullable().optional(),
        end_offset_sec: z.number().nullable().optional(),
        dom_signature: z.string().nullable().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal("INGEST_PARTICIPANT_SNAPSHOT"),
    payload: z.object({
      sessionId: z.string().min(1),
      body: z.object({
        captured_at: z.string(),
        participants: z.array(
          z.object({
            display_name: z.string().min(1),
            normalized_name: z.string().nullable().optional(),
            is_self: z.boolean().nullable().optional(),
            ui_source: z.string().nullable().optional(),
            confidence: z.number().nullable().optional(),
          }),
        ),
      }),
    }),
  }),
  z.object({
    type: z.literal("INGEST_SESSION_PAUSE"),
    payload: z.object({
      sessionId: z.string().min(1),
      pausedAtIso: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("INGEST_SESSION_END"),
    payload: z.object({
      sessionId: z.string().min(1),
      endedAtIso: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("AUDIO_RECORDING_START"),
    payload: z.object({
      sessionId: z.string().min(1),
      audioSegmentIndex: z.number().int().min(0).optional(),
    }),
  }),
  z.object({
    type: z.literal("AUDIO_RECORDING_STOP"),
    payload: z.object({
      sessionId: z.string().min(1),
      audioSegmentIndex: z.number().int().min(0).optional(),
      keepStream: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("AUDIO_ENABLE_FOR_SESSION"),
    payload: z.object({ sessionId: z.string().min(1) }),
  }),
]);

export type ParsedExtensionMessage = z.infer<typeof extensionMessageSchema>;

export function parseExtensionMessage(raw: unknown): ParsedExtensionMessage {
  return extensionMessageSchema.parse(raw);
}
