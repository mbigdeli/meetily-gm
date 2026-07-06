import type { MeetingCaptureSettings } from "../shared/types.js";

export interface SaveValidationError {
  ok: false;
  errors: string[];
}

export interface SaveValidationOk {
  ok: true;
  settings: MeetingCaptureSettings;
}

export type SaveValidationResult = SaveValidationError | SaveValidationOk;

/** Characters invalid anywhere in a Windows path segment. */
const INVALID_ANYWHERE = /[<>|?*\x00-\x1f"]/;

function pathLooksPlausible(p: string): boolean {
  const t = p.trim();
  if (!t) {
    return false;
  }
  if (INVALID_ANYWHERE.test(t)) {
    return false;
  }
  // Colon is only valid as drive letter (e.g. C:\...) or device path; reject stray colons.
  const firstColon = t.indexOf(":");
  if (firstColon === -1) {
    return true;
  }
  if (firstColon === 1 && /^[A-Za-z]:/.test(t)) {
    return !t.slice(2).includes(":");
  }
  return false;
}

/**
 * Options-page save gate: required roots and optional diarization hint range.
 * Persisted schema may allow empty roots for migration; the UI blocks save until both are set.
 */
export function validateSettingsForSave(settings: MeetingCaptureSettings): SaveValidationResult {
  const errors: string[] = [];

  if (!settings.rawStorageRoot.trim()) {
    errors.push("Raw Storage Root is required. Use a full folder path (for example C:\\MeetingCapture\\raw).");
  } else if (!pathLooksPlausible(settings.rawStorageRoot)) {
    errors.push("Raw Storage Root contains characters that are not valid in Windows paths.");
  }

  if (!settings.finalOutputRoot.trim()) {
    errors.push("Final Output Root is required. Use a full folder path (for example C:\\MeetingCapture\\final).");
  } else if (!pathLooksPlausible(settings.finalOutputRoot)) {
    errors.push("Final Output Root contains characters that are not valid in Windows paths.");
  }

  const hint = settings.diarizationSpeakerCountHint;
  if (hint !== null && (hint < 1 || hint > 32 || !Number.isInteger(hint))) {
    errors.push("Speaker count hint must be a whole number from 1 to 32, or leave the field empty.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    settings: {
      ...settings,
      rawStorageRoot: settings.rawStorageRoot.trim(),
      finalOutputRoot: settings.finalOutputRoot.trim(),
    },
  };
}
