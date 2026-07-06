import type { ExtensionMessage } from "../../shared/messages.js";
import { extractMeetingCode } from "../../shared/meetUtils.js";
import {
  getCaptureSegmentState,
  getLastCaptionLanguage,
  getSessionState,
  getSettings,
  patchSessionState,
  setCaptureSegmentState,
  setLastCaptionLanguage,
} from "../../shared/storage.js";
import { GoogleMeetDomAdapter } from "./adapter.js";
import { createDropdownPanel } from "./dropdown-panel.js";
import { MeetUiController } from "./controller.js";
import { createMeetWidgetHost } from "./widget.js";

const TAG = "[MCS meet-ui]";
const GLOBAL_KEY = "__mcsMeetUiController";
const CAPTURE_TEARDOWN_BRIDGE = "__mcsNotifyCaptureTeardown";
const HINT_ID = "mcs-capture-hint";

function showCaptureHint(): void {
  let hint = document.getElementById(HINT_ID);
  if (hint) {
    hint.remove();
  }
  hint = document.createElement("div");
  hint.id = HINT_ID;
  hint.textContent = "Click the extension icon in the toolbar to start recording (At the top right corner)";
  const s = hint.style;
  s.position = "fixed";
  s.bottom = "80px";
  s.left = "50%";
  s.transform = "translateX(-50%)";
  s.padding = "10px 20px";
  s.borderRadius = "8px";
  s.background = "#202124";
  s.color = "#e8eaed";
  s.fontSize = "13px";
  s.zIndex = "99999";
  s.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
  s.transition = "opacity 0.3s";
  document.body.appendChild(hint);
  setTimeout(() => {
    if (hint) {
      hint.style.opacity = "0";
    }
    setTimeout(() => hint?.remove(), 400);
  }, 4000);
}

type GlobalWindow = Window & typeof globalThis & {
  [GLOBAL_KEY]?: MeetUiController;
  [CAPTURE_TEARDOWN_BRIDGE]?: (reason: string) => Promise<void>;
};

function isActualMeetingRoom(): boolean {
  return extractMeetingCode(window.location.href) !== null;
}

function normalizeMeetingTitle(title: string): string {
  return title.replace(/\s+-\s+Google Meet$/, "").trim();
}

let dropdownPanel: ReturnType<typeof createDropdownPanel> | null = null;
let urlMonitorStarted = false;
let currentUrl = window.location.href;
let titleObserver: MutationObserver | null = null;

function teardownMeetUi(): void {
  const win = window as GlobalWindow;
  if (dropdownPanel) {
    dropdownPanel.destroy();
    dropdownPanel = null;
  }
  const controller = win[GLOBAL_KEY];
  if (controller) {
    console.info(TAG, "tearing down meet UI");
    void controller.stop();
    delete win[GLOBAL_KEY];
  }
}

async function notifyCaptureMeetingEnded(reason: "toolbar_removed" | "url_non_meeting"): Promise<void> {
  const win = window as GlobalWindow;
  const bridge = win[CAPTURE_TEARDOWN_BRIDGE];
  const session = await getSessionState();
  if (!session.isCaptureRunning) {
    return;
  }
  if (bridge) {
    await bridge(reason);
    return;
  }
  await chrome.runtime.sendMessage({
    type: "CAPTURE_STOP",
    payload: {},
  } satisfies ExtensionMessage);
}

function checkUrlChange(): void {
  if (window.location.href === currentUrl) {
    return;
  }
  const oldCode = extractMeetingCode(currentUrl);
  currentUrl = window.location.href;
  const newCode = extractMeetingCode(currentUrl);

  const wasInMeeting = oldCode !== null;
  const isInMeeting = newCode !== null;

  if (wasInMeeting && isInMeeting && oldCode !== newCode) {
    void notifyCaptureMeetingEnded("url_non_meeting").finally(() => {
      teardownMeetUi();
      void bootMeetUi();
    });
  } else if (!wasInMeeting && isInMeeting) {
    void bootMeetUi();
  } else if (wasInMeeting && !isInMeeting) {
    void notifyCaptureMeetingEnded("url_non_meeting").finally(() => {
      teardownMeetUi();
    });
  }
}

function ensureUrlMonitoring(): void {
  if (urlMonitorStarted) {
    return;
  }
  urlMonitorStarted = true;

  window.addEventListener("popstate", checkUrlChange);
  window.addEventListener("hashchange", checkUrlChange);

  const observeTitle = (): void => {
    titleObserver?.disconnect();
    const titleNode = document.querySelector("title");
    titleObserver = new MutationObserver(() => {
      checkUrlChange();
    });
    if (titleNode) {
      titleObserver.observe(titleNode, { childList: true, subtree: true, characterData: true });
    } else {
      titleObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  };
  observeTitle();

  const headMo = new MutationObserver(() => {
    if (document.querySelector("title") !== null) {
      observeTitle();
    }
    checkUrlChange();
  });
  headMo.observe(document.head, { childList: true, subtree: true });

  window.setInterval(checkUrlChange, 2_000);
}

async function bootMeetUi(): Promise<void> {
  const win = window as GlobalWindow;
  if (win[GLOBAL_KEY]) {
    return;
  }
  if (!isActualMeetingRoom()) {
    return;
  }

  try {
    const currentCode = extractMeetingCode(window.location.href);
    const segState = await getCaptureSegmentState();
    if (segState && segState.meetingCode !== currentCode) {
      await patchSessionState({
        isSessionPaused: false,
        captureRecordingAccumMs: 0,
        captureRecordingSegmentStartedAt: null,
      });
      await setCaptureSegmentState(null);
    }

    console.info(TAG, "booting meet UI for", window.location.href);

    const panel = createDropdownPanel(document);
    dropdownPanel = panel;

    let widgetRef: ReturnType<typeof createMeetWidgetHost> | null = null;

    const widget = createMeetWidgetHost(document, {
      onRecordToggle: () => {
        const running = widgetRef?.isCaptureRunning() ?? false;
        if (running) {
          void chrome.runtime.sendMessage({
            type: "CAPTURE_STOP",
            payload: {},
          } satisfies ExtensionMessage);
        } else {
          chrome.runtime.sendMessage(
            { type: "CAPTURE_START", payload: {} } satisfies ExtensionMessage,
            (resp: { ok?: boolean; needsInvocation?: boolean } | undefined) => {
              if (chrome.runtime.lastError || !resp?.ok) {
                if (resp?.needsInvocation) {
                  showCaptureHint();
                  void chrome.runtime.sendMessage({ type: "FLASH_BADGE" }).catch(() => undefined);
                }
              }
            },
          );
        }
      },
      onDropdownToggle: () => {
        const anchor = document.querySelector<HTMLElement>("[data-mcs-capture-dropdown]");
        if (anchor) {
          panel.toggle(anchor);
        }
      },
      onToolbarRemoved: async () => {
        console.info(TAG, "toolbar removed — stopping capture if running");
        if (widgetRef?.isCaptureRunning()) {
          const bridge = win[CAPTURE_TEARDOWN_BRIDGE];
          if (bridge) {
            await bridge("toolbar_removed");
          } else {
            await chrome.runtime.sendMessage({
              type: "CAPTURE_STOP",
              payload: {},
            } satisfies ExtensionMessage);
          }
        }
        teardownMeetUi();
      },
    });
    widgetRef = widget;

    const controller = new MeetUiController({
      adapter: new GoogleMeetDomAdapter(document),
      storage: {
        getSettings,
        getLastCaptionLanguage,
        setLastCaptionLanguage,
        patchSessionState,
      },
      widget,
      getMeetingTitle: () => normalizeMeetingTitle(document.title || ""),
    });

    panel.onLanguageRequested((lang) => {
      void controller.requestLanguageChange(lang);
    });

    void getSessionState().then((s) => {
      panel.update(s, s.currentLiveCaptionLanguage);
    });

    win[GLOBAL_KEY] = controller;
    void controller.start();

    window.addEventListener(
      "pagehide",
      () => {
        teardownMeetUi();
      },
      { once: true },
    );
  } catch (err) {
    console.error(TAG, "boot failed:", err);
  }
}

console.info(TAG, "content script loaded on", window.location.href);
ensureUrlMonitoring();

if (isActualMeetingRoom()) {
  void bootMeetUi();
} else {
  console.info(TAG, "not a meeting room — waiting for SPA navigation");
}
