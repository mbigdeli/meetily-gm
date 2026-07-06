import {
  meetingCaptureSettingsSchema,
  sessionStateSchema,
  liveCaptionLanguageSchema,
} from "./schemas.js";
import { STORAGE_KEYS } from "./storageKeys.js";
import type { CaptureSegmentState, LiveCaptionLanguage, MeetingCaptureSettings, SessionState } from "./types.js";
import { DEFAULT_SESSION_STATE, DEFAULT_SETTINGS } from "./types.js";

function getChromeLocal(): chrome.storage.LocalStorageArea {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw new Error("chrome.storage.local is not available");
  }
  return chrome.storage.local;
}

export async function getSettings(): Promise<MeetingCaptureSettings> {
  const raw = await getChromeLocal().get(STORAGE_KEYS.settings);
  const v = raw[STORAGE_KEYS.settings];
  if (v === undefined) {
    return { ...DEFAULT_SETTINGS };
  }
  return meetingCaptureSettingsSchema.parse(v);
}

export async function setSettings(next: MeetingCaptureSettings): Promise<void> {
  const parsed = meetingCaptureSettingsSchema.parse(next);
  await getChromeLocal().set({ [STORAGE_KEYS.settings]: parsed });
}

export async function getSessionState(): Promise<SessionState> {
  const raw = await getChromeLocal().get(STORAGE_KEYS.session);
  const v = raw[STORAGE_KEYS.session];
  if (v === undefined) {
    return { ...DEFAULT_SESSION_STATE };
  }
  return sessionStateSchema.parse(v);
}

export async function setSessionState(next: SessionState): Promise<void> {
  const parsed = sessionStateSchema.parse(next);
  await getChromeLocal().set({ [STORAGE_KEYS.session]: parsed });
}

export async function patchSessionState(partial: Partial<SessionState>): Promise<SessionState> {
  const current = await getSessionState();
  const merged = { ...current, ...partial };
  await setSessionState(merged);
  return merged;
}

export async function getLastCaptionLanguage(): Promise<LiveCaptionLanguage | null> {
  const raw = await getChromeLocal().get(STORAGE_KEYS.lastCaptionLanguage);
  const v = raw[STORAGE_KEYS.lastCaptionLanguage];
  if (v === undefined || v === null) {
    return null;
  }
  return liveCaptionLanguageSchema.parse(v);
}

export async function setLastCaptionLanguage(language: LiveCaptionLanguage): Promise<void> {
  const parsed = liveCaptionLanguageSchema.parse(language);
  await getChromeLocal().set({ [STORAGE_KEYS.lastCaptionLanguage]: parsed });
}

/** Resets volatile session fields; keeps settings and last caption language. */
export async function clearStaleSessionData(): Promise<void> {
  await setSessionState({ ...DEFAULT_SESSION_STATE });
}

export async function getCaptureSegmentState(): Promise<CaptureSegmentState | null> {
  const raw = await getChromeLocal().get(STORAGE_KEYS.captureSegmentState);
  const v = raw[STORAGE_KEYS.captureSegmentState];
  if (v === undefined || v === null) {
    return null;
  }
  return v as CaptureSegmentState;
}

export async function setCaptureSegmentState(state: CaptureSegmentState | null): Promise<void> {
  if (state === null) {
    await getChromeLocal().remove(STORAGE_KEYS.captureSegmentState);
  } else {
    await getChromeLocal().set({ [STORAGE_KEYS.captureSegmentState]: state });
  }
}
