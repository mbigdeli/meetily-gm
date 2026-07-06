import { extractMeetingCode } from "../../shared/meetUtils.js";
import { getRecordingElapsedMs } from "../../shared/recordingTimer.js";
import { getSessionState } from "../../shared/storage.js";
import { STORAGE_KEYS } from "../../shared/storageKeys.js";
import type { LiveCaptionLanguage } from "../../shared/types.js";
import { createMeetToolbarButton } from "./toolbar-injector.js";
import {
  INITIAL_WIDGET_STATE,
  type MeetWidgetHost,
  type MeetWidgetHostOptions,
  MeetWidgetState,
  MeetWidgetViewModel,
} from "./types.js";

function languageLabel(language: MeetWidgetState["currentLanguage"]): string {
  switch (language) {
    case "fa":
      return "Persian";
    case "en":
      return "English";
    case "unknown":
      return "Unknown";
    default:
      return assertNever(language);
  }
}

function captionLabel(captionState: MeetWidgetState["captionState"]): string {
  switch (captionState) {
    case "on":
      return "On";
    case "off":
      return "Off";
    case "unknown":
      return "Unknown";
    default:
      return assertNever(captionState);
  }
}

function shellClassName(mode: MeetWidgetState["mode"]): string {
  switch (mode) {
    case "loading":
      return "mcs-loading";
    case "ready":
      return "mcs-ready";
    case "switching":
      return "mcs-switching";
    case "error":
      return "mcs-error";
    default:
      return assertNever(mode);
  }
}

function formatMmSsFromMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function buildWidgetViewModel(state: MeetWidgetState): MeetWidgetViewModel {
  const disableButtons = state.mode === "switching";
  const button = (language: LiveCaptionLanguage, label: string) => ({
    language,
    label,
    active: state.currentLanguage === language,
    busy: state.busyLanguage === language,
    disabled: disableButtons,
  });

  return {
    shellClassName: shellClassName(state.mode),
    captionLabel: captionLabel(state.captionState),
    languageLabel: languageLabel(state.currentLanguage),
    message: state.message,
    buttons: [button("fa", "FA"), button("en", "EN")],
  };
}

/**
 * Meet UI host: native-style toolbar capture control + language handler hook
 * for a future dropdown (task 21). Caption/language state drives toolbar
 * Toolbar record/pause visuals follow **only** `isCaptureRunning` from session
 * storage (not widget `mode`: language “switching” must not fake a recording state).
 */
export function createMeetWidgetHost(doc: Document, options?: MeetWidgetHostOptions): MeetWidgetHost {
  const toolbar = createMeetToolbarButton(doc);
  /** Reserved for task 21 (dropdown invokes the same handler as the old FA/EN buttons). */
  const languageRef: {
    handler?: (language: LiveCaptionLanguage) => void;
  } = {};
  let lastState: MeetWidgetState = { ...INITIAL_WIDGET_STATE };
  let captureRunning = false;
  let sessionPaused = false;
  let metaTick: number | null = null;

  const syncToolbarRecordingVisual = (): void => {
    toolbar.updateState(captureRunning, sessionPaused);
  };

  const refreshToolbarRecordingMeta = (): void => {
    void getSessionState().then((s) => {
      const show = s.isCaptureRunning || s.isSessionPaused;
      const code = extractMeetingCode(doc.location.href) ?? "";
      const mmSs = formatMmSsFromMs(getRecordingElapsedMs(s));
      toolbar.updateRecordingMeta(show, code, mmSs);
    });
  };

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local" || !changes[STORAGE_KEYS.session]) {
      return;
    }
    const next = changes[STORAGE_KEYS.session].newValue as
      | { isCaptureRunning?: boolean; isSessionPaused?: boolean }
      | undefined;
    if (next) {
      if (typeof next.isCaptureRunning === "boolean") {
        captureRunning = next.isCaptureRunning;
      }
      if (typeof next.isSessionPaused === "boolean") {
        sessionPaused = next.isSessionPaused;
      }
      syncToolbarRecordingVisual();
      refreshToolbarRecordingMeta();
    }
  };

  if (options?.onRecordToggle) {
    toolbar.onRecordToggle(options.onRecordToggle);
  }
  if (options?.onDropdownToggle) {
    toolbar.onDropdownToggle(options.onDropdownToggle);
  }
  if (options?.onToolbarRemoved) {
    const handler = options.onToolbarRemoved;
    toolbar.onToolbarRemoved(() => {
      void Promise.resolve(handler());
    });
  }

  return {
    mount() {
      chrome.storage.onChanged.addListener(onStorageChanged);
      void getSessionState().then((s) => {
        captureRunning = s.isCaptureRunning;
        sessionPaused = s.isSessionPaused;
        syncToolbarRecordingVisual();
        refreshToolbarRecordingMeta();
      });
      toolbar.mount();
      metaTick = window.setInterval(refreshToolbarRecordingMeta, 1000);
    },

    render(state: MeetWidgetState) {
      lastState = state;
      syncToolbarRecordingVisual();
      refreshToolbarRecordingMeta();
    },

    setLanguageHandler(handler: (language: LiveCaptionLanguage) => void) {
      languageRef.handler = handler;
    },

    isCaptureRunning() {
      return captureRunning;
    },

    destroy() {
      if (metaTick !== null) {
        window.clearInterval(metaTick);
        metaTick = null;
      }
      chrome.storage.onChanged.removeListener(onStorageChanged);
      toolbar.destroy();
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled widget state: ${String(value)}`);
}
