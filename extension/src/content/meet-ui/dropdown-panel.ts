import { getRecordingElapsedMs } from "../../shared/recordingTimer.js";
import { getSessionState } from "../../shared/storage.js";
import { STORAGE_KEYS } from "../../shared/storageKeys.js";
import type { LiveCaptionLanguage, SessionState } from "../../shared/types.js";
import {
  ACCENT,
  CLONE_PANEL_PROPS,
  FALLBACK_PANEL_STYLE,
  MUTED,
  PANEL_Z_INDEX,
  STYLE_ID,
} from "./dropdownPanelStyles.js";

export interface DropdownPanel {
  show(anchorEl: HTMLElement): void;
  hide(): void;
  toggle(anchorEl: HTMLElement): void;
  update(session: SessionState, language: LiveCaptionLanguage | null): void;
  onLanguageRequested(handler: (lang: LiveCaptionLanguage) => void): void;
  destroy(): void;
}

function ariaLabelLower(el: Element): string {
  return (el.getAttribute("aria-label") || "").toLowerCase();
}

function findAudioSettingsButton(doc: Document): HTMLButtonElement | null {
  const buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>("button[aria-label]"));
  for (const b of buttons) {
    const label = ariaLabelLower(b);
    if (label.includes("audio settings")) {
      return b;
    }
  }
  return null;
}

/** Best-effort: floating panel ancestor when Meet’s audio menu is open. */
function findMeetAudioFloatingPanel(doc: Document): HTMLElement | null {
  const btn = findAudioSettingsButton(doc);
  if (!btn) {
    return null;
  }
  let el: HTMLElement | null = btn;
  for (let i = 0; i < 12 && el; i += 1) {
    el = el.parentElement;
    if (!el || el === doc.body) {
      break;
    }
    const cs = window.getComputedStyle(el);
    const r = parseFloat(cs.borderRadius || "0");
    if ((cs.position === "fixed" || cs.position === "absolute") && r >= 4) {
      return el;
    }
  }
  return null;
}

function applyComputedStyleSubset(
  target: HTMLElement,
  source: HTMLElement,
  props: readonly string[],
): void {
  const cs = window.getComputedStyle(source);
  for (const prop of props) {
    const v = cs.getPropertyValue(prop);
    if (v) {
      target.style.setProperty(prop, v);
    }
  }
}

function applyFallbackPanelStyle(panel: HTMLElement): void {
  for (const [k, v] of Object.entries(FALLBACK_PANEL_STYLE)) {
    if (v) {
      panel.style.setProperty(k, v);
    }
  }
}

function formatHhMmSsFromMs(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function ensureDropdownPanelStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
[data-mcs-dropdown-panel] {
  box-sizing: border-box;
  position: fixed;
  visibility: hidden;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}
[data-mcs-dropdown-panel][data-mcs-visible="true"] {
  visibility: visible;
}
[data-mcs-dropdown-panel] * {
  box-sizing: border-box;
}
[data-mcs-rec-section] {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
[data-mcs-rec-time] {
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
[data-mcs-clock-icon] {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
[data-mcs-clock-icon] i {
  font-size: 18px;
  opacity: 0.7;
}
[data-mcs-lang-track] {
  width: 110px;
  height: 32px;
  border-radius: 16px;
  background: rgba(255,255,255,0.08);
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  user-select: none;
  overflow: hidden;
  flex-shrink: 0;
}
[data-mcs-lang-track] > span:not([data-mcs-lang-knob]) {
  flex: 1;
  text-align: center;
  position: relative;
  z-index: 1;
  line-height: 32px;
  transition: color 0.2s;
}
[data-mcs-lang-knob] {
  position: absolute;
  top: 3px;
  height: 26px;
  border-radius: 13px;
  background: ${ACCENT};
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  transition: left 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}
[data-mcs-gear-btn] {
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  opacity: 0.65;
  transition: opacity 0.2s, background 0.2s;
}
[data-mcs-gear-btn]:hover {
  background: #3b3b3b;
}
[data-mcs-gear-btn] i {
  font-size: 20px;
}
`;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function createDropdownPanel(doc: Document): DropdownPanel {
  ensureDropdownPanelStyles(doc);

  const panel = doc.createElement("div");
  panel.setAttribute("data-mcs-dropdown-panel", "true");
  panel.setAttribute("data-mcs-visible", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Capture settings");

  const recSection = doc.createElement("div");
  recSection.setAttribute("data-mcs-rec-section", "true");
  const clockWrap = doc.createElement("span");
  clockWrap.setAttribute("data-mcs-clock-icon", "true");
  const clockIcon = doc.createElement("i");
  clockIcon.className = "google-symbols notranslate";
  clockIcon.textContent = "schedule";
  clockWrap.appendChild(clockIcon);
  const recTime = doc.createElement("div");
  recTime.setAttribute("data-mcs-rec-time", "true");
  recSection.appendChild(clockWrap);
  recSection.appendChild(recTime);

  const langTrack = doc.createElement("div");
  langTrack.setAttribute("data-mcs-lang-track", "true");
  langTrack.setAttribute("role", "switch");
  const faSpan = doc.createElement("span");
  faSpan.textContent = "FA";
  const enSpan = doc.createElement("span");
  enSpan.textContent = "EN";
  const knob = doc.createElement("span");
  knob.setAttribute("data-mcs-lang-knob", "true");
  langTrack.appendChild(faSpan);
  langTrack.appendChild(enSpan);
  langTrack.appendChild(knob);

  const gearBtn = doc.createElement("button");
  gearBtn.type = "button";
  gearBtn.setAttribute("data-mcs-gear-btn", "true");
  gearBtn.setAttribute("aria-label", "Open extension settings");
  const gearIcon = doc.createElement("i");
  gearIcon.className = "google-symbols notranslate";
  gearIcon.textContent = "settings";
  gearBtn.appendChild(gearIcon);

  panel.appendChild(recSection);
  panel.appendChild(langTrack);
  panel.appendChild(gearBtn);

  let visible = false;
  let languageHandler: ((lang: LiveCaptionLanguage) => void) | null = null;

  let lastSession: SessionState | null = null;
  let lastLanguage: LiveCaptionLanguage | null = null;

  let tickHandle: number | null = null;
  let pollHandle: number | null = null;
  let repositionRaf: number | null = null;

  const onDocMouseDown = (e: MouseEvent): void => {
    if (!visible) {
      return;
    }
    const t = e.target as Node;
    if (panel.contains(t)) {
      return;
    }
    const drop = doc.querySelector("[data-mcs-capture-dropdown]");
    if (drop?.contains(t)) {
      return;
    }
    hide();
  };

  const onDocKeyDown = (e: KeyboardEvent): void => {
    if (!visible) {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  };

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local" || !changes[STORAGE_KEYS.session]) {
      return;
    }
    void refreshFromStorage();
  };

  const applyPanelShellStyles = (): void => {
    const native = findMeetAudioFloatingPanel(doc);
    if (native) {
      applyComputedStyleSubset(panel, native, CLONE_PANEL_PROPS);
    } else {
      applyFallbackPanelStyle(panel);
    }
    panel.style.zIndex = PANEL_Z_INDEX;
  };

  const updateLanguageVisual = (lang: LiveCaptionLanguage | null): void => {
    const trackW = langTrack.offsetWidth || 220;
    const pad = 3;
    const knobW = Math.floor(trackW / 2) - pad;
    const isEn = lang === "en";
    const leftPx = isEn ? Math.ceil(trackW / 2) : pad;
    knob.style.left = `${leftPx}px`;
    knob.style.width = `${knobW}px`;

    faSpan.style.color = !isEn ? "#202124" : MUTED;
    enSpan.style.color = isEn ? "#202124" : MUTED;
    langTrack.setAttribute("aria-checked", isEn ? "true" : "false");
  };

  const updateRecordingLabel = (): void => {
    const s = lastSession;
    if (!s) {
      recTime.textContent = "Not recording";
      recTime.style.opacity = "0.55";
      recTime.style.color = "";
      return;
    }
    const running = s.isCaptureRunning === true;
    const sessionPaused = s.isSessionPaused === true;
    if (!running && !sessionPaused) {
      recTime.textContent = "Not recording";
      recTime.style.opacity = "0.55";
      recTime.style.color = "";
      return;
    }
    const elapsed = getRecordingElapsedMs(s);
    recTime.textContent = formatHhMmSsFromMs(elapsed);
    recTime.style.opacity = running ? "1" : "0.75";
    recTime.style.color = sessionPaused ? "#e8a317" : "";
  };

  const stopTick = (): void => {
    if (tickHandle !== null) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  };

  const startTickIfNeeded = (): void => {
    stopTick();
    if (!visible) {
      return;
    }
    tickHandle = window.setInterval(() => {
      const anchor = doc.querySelector<HTMLElement>("[data-mcs-capture-dropdown]");
      if (!anchor?.isConnected) {
        hide();
        return;
      }
      updateRecordingLabel();
    }, 1000);
  };

  const positionCenter = (): void => {
    if (repositionRaf !== null) {
      cancelAnimationFrame(repositionRaf);
    }
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = null;
      if (!visible) {
        return;
      }
      applyPanelShellStyles();
      panel.style.visibility = "hidden";
      panel.style.left = "0";
      panel.style.bottom = "0";
      panel.style.display = "flex";
      doc.body.appendChild(panel);
      const pw = panel.offsetWidth;
      const toolbar = doc.querySelector<HTMLElement>("[data-mcs-toolbar-root]");
      let bottomOffset = 80;
      if (toolbar) {
        const tbRect = toolbar.getBoundingClientRect();
        bottomOffset = window.innerHeight - tbRect.top + 8;
      }
      const left = Math.max(8, (window.innerWidth - pw) / 2);
      panel.style.bottom = `${bottomOffset}px`;
      panel.style.left = `${left}px`;
      panel.style.visibility = "";
      updateLanguageVisual(lastLanguage);
    });
  };

  const applyState = (session: SessionState, language: LiveCaptionLanguage | null): void => {
    lastSession = session;
    lastLanguage = language;
    updateRecordingLabel();
    if (visible) {
      updateLanguageVisual(language);
    }
  };

  const refreshFromStorage = async (): Promise<void> => {
    const session = await getSessionState();
    applyState(session, session.currentLiveCaptionLanguage);
    if (visible) {
      positionCenter();
    }
  };

  const onGearClick = (e: MouseEvent): void => {
    e.stopPropagation();
    void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE", payload: {} });
  };

  const onLangTrackClick = (e: MouseEvent): void => {
    e.stopPropagation();
    const next: LiveCaptionLanguage = lastLanguage === "en" ? "fa" : "en";
    languageHandler?.(next);
  };

  gearBtn.addEventListener("click", onGearClick);
  langTrack.addEventListener("click", onLangTrackClick);

  const show = (_anchorEl: HTMLElement): void => {
    visible = true;
    panel.setAttribute("data-mcs-visible", "true");
    applyPanelShellStyles();
    void refreshFromStorage();
    positionCenter();
    startTickIfNeeded();
    doc.addEventListener("mousedown", onDocMouseDown, true);
    doc.addEventListener("keydown", onDocKeyDown, true);
  };

  const hide = (): void => {
    visible = false;
    panel.setAttribute("data-mcs-visible", "false");
    panel.remove();
    stopTick();
    doc.removeEventListener("mousedown", onDocMouseDown, true);
    doc.removeEventListener("keydown", onDocKeyDown, true);
  };

  const toggle = (anchorEl: HTMLElement): void => {
    if (visible) {
      hide();
    } else {
      show(anchorEl);
    }
  };

  const update = (session: SessionState, language: LiveCaptionLanguage | null): void => {
    applyState(session, language);
    if (visible) {
      updateLanguageVisual(language);
      positionCenter();
    }
  };

  const onLanguageRequested = (handler: (lang: LiveCaptionLanguage) => void): void => {
    languageHandler = handler;
  };

  const destroy = (): void => {
    hide();
    stopTick();
    if (pollHandle !== null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
    if (repositionRaf !== null) {
      cancelAnimationFrame(repositionRaf);
      repositionRaf = null;
    }
    chrome.storage.onChanged.removeListener(onStorageChanged);
    window.removeEventListener("resize", onResize);
    gearBtn.removeEventListener("click", onGearClick);
    langTrack.removeEventListener("click", onLangTrackClick);
    panel.remove();
  };

  chrome.storage.onChanged.addListener(onStorageChanged);
  pollHandle = window.setInterval(() => {
    void refreshFromStorage();
  }, 10_000);

  void getSessionState().then((session) => {
    applyState(session, session.currentLiveCaptionLanguage);
  });

  const onResize = (): void => {
    if (visible) {
      positionCenter();
    }
  };
  window.addEventListener("resize", onResize);

  return {
    show,
    hide,
    toggle,
    update,
    onLanguageRequested,
    destroy,
  };
}
