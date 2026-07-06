import type { LiveCaptionLanguage, MeetingCaptureSettings, SessionState } from "../../shared/types.js";

export interface CaptionSnapshot {
  enabled: boolean | null;
  language: LiveCaptionLanguage | null;
}

export interface MeetDomAdapter {
  detectMeetReady(): boolean | Promise<boolean>;
  detectCaptionState(): Promise<CaptionSnapshot>;
  ensureCaptionsEnabled(): Promise<boolean>;
  openCaptionControls(): Promise<boolean>;
  setCaptionLanguageFA(): Promise<boolean>;
  setCaptionLanguageEN(): Promise<boolean>;
  confirmCaptionLanguage(): Promise<LiveCaptionLanguage | null>;
}

export type MeetWidgetMode = "loading" | "ready" | "switching" | "error";
export type CaptionDisplayState = "unknown" | "off" | "on";
export type WidgetLanguageState = LiveCaptionLanguage | "unknown";

export interface MeetWidgetState {
  mode: MeetWidgetMode;
  captionState: CaptionDisplayState;
  currentLanguage: WidgetLanguageState;
  message: string;
  busyLanguage: LiveCaptionLanguage | null;
}

export interface MeetWidgetButtonState {
  language: LiveCaptionLanguage;
  label: string;
  active: boolean;
  busy: boolean;
  disabled: boolean;
}

export interface MeetWidgetViewModel {
  shellClassName: string;
  captionLabel: string;
  languageLabel: string;
  message: string;
  buttons: MeetWidgetButtonState[];
}

export interface MeetWidgetHost {
  mount(): void;
  render(state: MeetWidgetState): void;
  setLanguageHandler(handler: (language: LiveCaptionLanguage) => void): void;
  isCaptureRunning(): boolean;
  destroy(): void;
}

/** Factory options for `createMeetWidgetHost` (toolbar capture control + future dropdown). */
export interface MeetWidgetHostOptions {
  onRecordToggle?: () => void | Promise<void>;
  onDropdownToggle?: () => void;
  /** Fired when Meet removes the in-call toolbar (leave call, disconnect, etc.). */
  onToolbarRemoved?: () => void | Promise<void>;
}

export interface MeetUiStorage {
  getSettings(): Promise<MeetingCaptureSettings>;
  getLastCaptionLanguage(): Promise<LiveCaptionLanguage | null>;
  setLastCaptionLanguage(language: LiveCaptionLanguage): Promise<void>;
  patchSessionState(partial: Partial<SessionState>): Promise<SessionState>;
}

export const INITIAL_WIDGET_STATE: MeetWidgetState = {
  mode: "loading",
  captionState: "unknown",
  currentLanguage: "unknown",
  message: "Waiting for Google Meet controls...",
  busyLanguage: null,
};
