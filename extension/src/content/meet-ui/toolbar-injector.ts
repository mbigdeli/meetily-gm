import { ensureToolbarStyles } from "./toolbar-styles.js";

const TAG = "[MCS toolbar]";

const TOOLBAR_REMOVAL_CONFIRM_MS = 600;
const POLL_FOR_TOOLBAR_MS = 2_500;
const MAX_FALLBACK_DEPTH = 8;

export interface MeetToolbarButton {
  mount(): void;
  updateState(recording: boolean, paused?: boolean): void;
  /** Meeting code + MM:SS while recording or paused in this Meet. */
  updateRecordingMeta(visible: boolean, meetingCode: string, timeMmSs: string): void;
  onRecordToggle(handler: () => void): void;
  onDropdownToggle(handler: () => void): void;
  isToolbarPresent(): boolean;
  onToolbarRemoved(handler: () => void): void;
  destroy(): void;
}

function findMicButton(doc: Document): HTMLButtonElement | null {
  const byMuted = doc.querySelector<HTMLButtonElement>("button[data-is-muted]");
  if (byMuted) {
    return byMuted;
  }
  for (const b of Array.from(doc.querySelectorAll<HTMLButtonElement>("button[aria-label]"))) {
    const label = (b.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("microphone") || /\bmic\b/.test(label)) {
      return b;
    }
  }
  for (const icon of Array.from(doc.querySelectorAll<HTMLElement>("i.google-symbols, span.google-symbols"))) {
    const text = (icon.textContent || "").trim().toLowerCase();
    if (text === "mic" || text === "mic_off") {
      const btn = icon.closest("button");
      if (btn instanceof HTMLButtonElement) {
        return btn;
      }
    }
  }
  return null;
}

/**
 * Detects the "Leave call" button which only exists during an active meeting.
 * This is the primary gate for determining if the user is in an actual call
 * (not in the pre-meeting lobby or post-meeting screen).
 */
function findLeaveCallButton(doc: Document): HTMLButtonElement | null {
  // Primary: button with call_end icon (most reliable)
  for (const icon of Array.from(doc.querySelectorAll<HTMLElement>("i.google-symbols, span.google-symbols"))) {
    const text = (icon.textContent || "").trim().toLowerCase();
    if (text === "call_end") {
      const btn = icon.closest("button");
      if (btn instanceof HTMLButtonElement) {
        return btn;
      }
    }
  }
  // Fallback: aria-label containing "leave call" or "leave meeting" (locale-dependent)
  for (const btn of Array.from(doc.querySelectorAll<HTMLButtonElement>("button[aria-label]"))) {
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("leave call") || label.includes("leave meeting")) {
      return btn;
    }
  }
  return null;
}

function resolveInjectionTarget(
  doc: Document,
): { row: HTMLElement; before: HTMLElement } | null {
  const mic = findMicButton(doc);
  if (!mic) {
    return null;
  }

  const tooltipWrap = mic.closest("[data-is-tooltip-wrapper='true']");
  if (tooltipWrap) {
    const groupWrap = tooltipWrap.parentElement;
    const row = groupWrap?.parentElement;
    if (
      groupWrap && row &&
      row instanceof HTMLElement && groupWrap instanceof HTMLElement &&
      row.children.length >= 5
    ) {
      return { row, before: groupWrap };
    }
  }

  let child: HTMLElement = mic;
  let depth = 0;
  while (child.parentElement && child.parentElement !== doc.body && depth < MAX_FALLBACK_DEPTH) {
    const parent = child.parentElement;
    if (!(parent instanceof HTMLElement)) {
      break;
    }
    if (parent.children.length >= 5) {
      return { row: parent, before: child };
    }
    child = parent;
    depth++;
  }

  return null;
}

function buildToolbarMarkup(doc: Document): HTMLElement {
  const root = doc.createElement("div");
  root.setAttribute("data-mcs-toolbar-root", "true");

  const btnDrop = doc.createElement("button");
  btnDrop.type = "button";
  btnDrop.className = "mcs-capture-arrow";
  btnDrop.setAttribute("data-mcs-capture-dropdown", "true");
  btnDrop.setAttribute("aria-label", "Capture settings");
  btnDrop.setAttribute("data-tooltip", "Capture settings");

  const iconDrop = doc.createElement("i");
  iconDrop.className = "google-symbols notranslate";
  iconDrop.textContent = "keyboard_arrow_up";
  btnDrop.appendChild(iconDrop);

  const btnMain = doc.createElement("button");
  btnMain.type = "button";
  btnMain.className = "mcs-capture-btn";
  btnMain.setAttribute("data-mcs-capture-main", "true");
  btnMain.setAttribute("aria-label", "Start capture recording");
  btnMain.setAttribute("data-tooltip", "Start capture recording");

  const liveDot = doc.createElement("span");
  liveDot.className = "mcs-capture-btn__live";
  liveDot.setAttribute("aria-hidden", "true");
  liveDot.hidden = true;

  const iconMain = doc.createElement("i");
  iconMain.className = "google-symbols notranslate mcs-capture-btn__icon";
  iconMain.textContent = "fiber_manual_record";
  btnMain.appendChild(liveDot);
  btnMain.appendChild(iconMain);

  const meta = doc.createElement("div");
  meta.className = "mcs-toolbar-rec-meta";
  meta.setAttribute("data-mcs-toolbar-rec-meta", "true");
  meta.hidden = true;
  const timeLine = doc.createElement("div");
  timeLine.className = "mcs-toolbar-rec-meta__time";
  timeLine.setAttribute("data-mcs-rec-time", "true");

  meta.appendChild(timeLine);
  
  root.appendChild(meta);
  root.appendChild(btnDrop);
  root.appendChild(btnMain);

  return root;
}

export function createMeetToolbarButton(doc: Document): MeetToolbarButton {
  ensureToolbarStyles(doc);

  let root: HTMLElement | null = null;
  let mainBtn: HTMLButtonElement | null = null;
  let dropBtn: HTMLButtonElement | null = null;

  let recording = false;
  let paused = false;
  let recordHandler: (() => void) | null = null;
  let dropdownHandler: (() => void) | null = null;
  let toolbarRemovedHandler: (() => void) | null = null;

  let observer: MutationObserver | null = null;
  let pollTimer: number | null = null;
  let injectScheduled = false;
  let toolbarRemovalTimer: number | null = null;
  let toolbarRemovedNotified = false;
  let hasEverInjected = false;

  const applyRecordingState = (): void => {
    if (!mainBtn) {
      return;
    }
    mainBtn.classList.toggle("mcs-recording", recording);
    mainBtn.classList.toggle("mcs-paused", !recording && paused);
    const icon = mainBtn.querySelector<HTMLElement>(".mcs-capture-btn__icon");
    const live = mainBtn.querySelector<HTMLElement>(".mcs-capture-btn__live");
    if (icon) {
      icon.textContent = recording ? "pause" : "fiber_manual_record";
    }
    if (live) {
      live.hidden = !recording;
    }
    const label = recording
      ? "Pause capture"
      : paused
        ? "Resume capture"
        : "Start capture";
    mainBtn.setAttribute("aria-label", label);
    mainBtn.setAttribute("data-tooltip", label);
  };

  const cancelToolbarRemovalCheck = (): void => {
    if (toolbarRemovalTimer !== null) {
      window.clearTimeout(toolbarRemovalTimer);
      toolbarRemovalTimer = null;
    }
  };

  const clearRefs = (): void => {
    root = null;
    mainBtn = null;
    dropBtn = null;
  };

  const tryInject = (): boolean => {
    if (root?.isConnected) {
      cancelToolbarRemovalCheck();
      toolbarRemovedNotified = false;
      return true;
    }
    if (root && !root.isConnected) {
      clearRefs();
    }

    // GATE 1: Must be in active meeting (leave call button exists)
    // This prevents injection on pre-meeting lobby or post-meeting screens
    if (!findLeaveCallButton(doc)) {
      return false;
    }

    // GATE 2: Need mic button for style cloning and toolbar row finding
    if (!findMicButton(doc)) {
      return false;
    }

    root = buildToolbarMarkup(doc);
    mainBtn = root.querySelector<HTMLButtonElement>("[data-mcs-capture-main]");
    dropBtn = root.querySelector<HTMLButtonElement>("[data-mcs-capture-dropdown]");

    if (!mainBtn || !dropBtn) {
      root.remove();
      clearRefs();
      return false;
    }

    mainBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      recordHandler?.();
    });
    dropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownHandler?.();
    });

    const target = resolveInjectionTarget(doc);
    if (!target) {
      console.warn(TAG, "mic button found but insertion target could not be resolved");
      root.remove();
      clearRefs();
      return false;
    }

    target.row.insertBefore(root, target.before);
    hasEverInjected = true;
    cancelToolbarRemovalCheck();
    toolbarRemovedNotified = false;
    applyRecordingState();
    console.info(TAG, "capture button injected into Meet toolbar");
    return true;
  };

  const confirmToolbarRemoved = (): void => {
    toolbarRemovalTimer = null;
    if (root?.isConnected) {
      toolbarRemovedNotified = false;
      return;
    }
    if (tryInject()) {
      return;
    }
    if (resolveInjectionTarget(doc)) {
      scheduleInject();
      return;
    }
    if (!hasEverInjected) {
      return;
    }
    if (!toolbarRemovedNotified) {
      toolbarRemovedNotified = true;
      console.info(TAG, "Meet toolbar removed — firing onToolbarRemoved");
      toolbarRemovedHandler?.();
    }
  };

  const scheduleToolbarRemovalCheck = (): void => {
    if (toolbarRemovalTimer !== null) {
      return;
    }
    toolbarRemovalTimer = window.setTimeout(confirmToolbarRemoved, TOOLBAR_REMOVAL_CONFIRM_MS);
  };

  const scheduleInject = (): void => {
    if (injectScheduled) {
      return;
    }
    injectScheduled = true;
    requestAnimationFrame(() => {
      injectScheduled = false;
      if (!root?.isConnected) {
        const ok = tryInject();
        if (ok && !observer) {
          startObserver();
          stopPoll();
        } else if (!ok) {
          scheduleToolbarRemovalCheck();
        }
      }
    });
  };

  const startObserver = (): void => {
    if (observer) {
      return;
    }
    observer = new MutationObserver(() => {
      if (!root?.isConnected) {
        scheduleInject();
      } else {
        cancelToolbarRemovalCheck();
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  };

  const startPoll = (): void => {
    if (pollTimer !== null) {
      return;
    }
    pollTimer = window.setInterval(() => {
      if (!root?.isConnected) {
        scheduleInject();
      }
    }, POLL_FOR_TOOLBAR_MS);
  };

  const stopPoll = (): void => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  return {
    mount() {
      console.info(TAG, "mount — polling for Meet toolbar");
      startPoll();
      scheduleInject();
    },

    updateState(nextRecording: boolean, nextPaused?: boolean) {
      recording = nextRecording;
      paused = nextPaused ?? false;
      applyRecordingState();
    },

    updateRecordingMeta(visible: boolean, meetingCode: string, timeMmSs: string) {
      if (!root) {
        return;
      }
      const meta = root.querySelector<HTMLElement>("[data-mcs-toolbar-rec-meta]");
      const timeEl = root.querySelector<HTMLElement>("[data-mcs-rec-time]");
      if (!meta || !timeEl) {
        return;
      }
      meta.hidden = !visible;
      timeEl.textContent = timeMmSs;
    },

    onRecordToggle(handler: () => void) {
      recordHandler = handler;
    },

    onDropdownToggle(handler: () => void) {
      dropdownHandler = handler;
    },

    isToolbarPresent() {
      // Leave call button = in active meeting (not lobby or post-meeting)
      // Mic button = toolbar has standard controls for style cloning
      return findLeaveCallButton(doc) !== null && findMicButton(doc) !== null;
    },

    onToolbarRemoved(handler: () => void) {
      toolbarRemovedHandler = handler;
    },

    destroy() {
      console.info(TAG, "destroy — removing capture button and observer");
      observer?.disconnect();
      observer = null;
      stopPoll();
      cancelToolbarRemovalCheck();
      root?.remove();
      clearRefs();
      recordHandler = null;
      dropdownHandler = null;
      toolbarRemovedHandler = null;
      toolbarRemovedNotified = false;
      hasEverInjected = false;
    },
  };
}
