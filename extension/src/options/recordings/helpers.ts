import type { RecordingReadiness, TranscriptSegment } from "../../shared/recordingsTypes.js";
import type { StatusTone } from "../statusPresentation.js";

export const AUDIO_CHUNK_BYTES = 360 * 1024;

export function readinessLabel(readiness: RecordingReadiness | "loading" | "processing" | "none"): string {
  switch (readiness) {
    case "recording":
      return "Recording";
    case "paused":
      return "Paused";
    case "finalizing":
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "audio_only":
      return "Audio only";
    case "transcript_only":
      return "Transcript only";
    case "failed":
      return "Failed";
    case "missing":
      return "Missing files";
    case "loading":
      return "Loading";
    case "none":
      return "Not started";
  }
}

export function readinessTone(readiness: RecordingReadiness | "loading" | "processing" | "none"): StatusTone {
  switch (readiness) {
    case "ready":
    case "recording":
      return "success";
    case "paused":
    case "finalizing":
    case "processing":
    case "audio_only":
    case "transcript_only":
    case "loading":
      return "warning";
    case "failed":
    case "missing":
      return "error";
    case "none":
      return "neutral";
  }
}

export function activeTranscriptIndex(segments: TranscriptSegment[], currentTime: number): number {
  return segments.findIndex((segment) => currentTime >= segment.start_sec && currentTime < segment.end_sec);
}

export function transcriptPreview(segments: TranscriptSegment[], maxChars = 220): string {
  const text = segments
    .slice(0, 4)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1).trim()}...`;
}

export function base64ToBytes(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array();
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function textDirection(language: string | null | undefined, text: string): "rtl" | "ltr" | "auto" {
  if (language === "fa" || language === "ar") {
    return "rtl";
  }
  if (language === "en") {
    return "ltr";
  }
  return /[\u0600-\u06ff]/.test(text) ? "rtl" : "auto";
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
