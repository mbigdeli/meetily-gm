import { GoogleMeetDomAdapter } from "../meet-ui/adapter.js";
import { findCaptionRegion } from "./caption-parser.js";
import { getSessionState } from "../../shared/storage.js";
import { STORAGE_KEYS } from "../../shared/storageKeys.js";

const STEALTH_STYLE_ID = "mcs-stealth-caption-hide";

const CAPTION_TOGGLE_PATTERNS = ["turn on captions", "turn off captions", "captions", "subtitles"] as const;

const INTERACTIVE_SELECTOR = [
  "button",
  "[role='button']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='tab']",
  "[aria-label]",
].join(",");

const REGION_POLL_MS = 500;
const REGION_POLL_MAX_ATTEMPTS = 10;

const WATCHDOG_DEBOUNCE_MS = 150;
const REENABLE_DELAY_MS = 500;

const HIDE_CSS = `
/* Target: div[role="region"][tabindex="0"] that is the caption container */
div[role="region"][tabindex="0"] {
  visibility: hidden !important;
  position: fixed !important;
  top: -9999px !important;
  left: -9999px !important;
  pointer-events: none !important;
  opacity: 0 !important;
}
`.trim();

const CC_DISABLED_TOOLTIP = "Captions cannot be disabled while recording";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function textForElement(element: Element | null): string {
  if (!element) {
    return "";
  }
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const value =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "";
  return normalizeText([ariaLabel, title, value, element.textContent].filter(Boolean).join(" "));
}

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function hasRole(element: HTMLElement, roles: readonly string[]): boolean {
  const role = normalizeText(element.getAttribute("role"));
  if (!role) {
    return roles.includes("button") && element.tagName === "BUTTON";
  }
  return roles.includes(role);
}

function interactiveElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)).filter(isVisible);
}

/**
 * Same discovery rules as {@link GoogleMeetDomAdapter}'s private
 * `findCaptionToggleButton` (adapter must not be modified per task 22).
 */
function findCaptionToggleButton(doc: Document): HTMLElement | null {
  return (
    interactiveElements(doc).find((element) => {
      const text = textForElement(element);
      const matchesPattern = CAPTION_TOGGLE_PATTERNS.some((pattern) => text.includes(pattern));
      return (
        matchesPattern &&
        hasRole(element, ["button"]) &&
        (text.includes("caption") || text.includes("subtitle"))
      );
    }) ?? null
  );
}

export class StealthCaptionManager {
  private readonly adapter: GoogleMeetDomAdapter;

  private active = false;
  /** When true, our hide stylesheet is applied (user does not see overlay). */
  private captionHiddenByUs = true;

  private hideStyleEl: HTMLStyleElement | null = null;
  private ccButton: HTMLElement | null = null;

  private captionWatchdog: MutationObserver | null = null;
  private watchdogDebounce: number | null = null;

  private ccRemountObserver: MutationObserver | null = null;
  private ccRemountDebounce: number | null = null;

  private lastKnownRegion: Element | null = null;
  private reenableTimer: number | null = null;
  /** True after `ensureCaptionsEnabled()` succeeded for this activation (watchdog / storage re-enable only then). */
  private hadSuccessfulEnsure = false;

  private readonly storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local" || !changes[STORAGE_KEYS.session]) {
      return;
    }
    if (!this.active) {
      return;
    }
    void this.onSessionStorageChanged();
  };

  constructor(private readonly doc: Document) {
    this.adapter = new GoogleMeetDomAdapter(doc);
  }

  async activate(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    this.captionHiddenByUs = false;
    this.lastKnownRegion = null;
    this.hadSuccessfulEnsure = false;

    const ensured = await this.adapter.ensureCaptionsEnabled();
    if (!ensured) {
      console.warn("[MCS] stealth: ensureCaptionsEnabled failed — capture continues");
      this.installCaptionWatchdog();
      chrome.storage.onChanged.addListener(this.storageListener);
      return;
    }
    this.hadSuccessfulEnsure = true;

    const region = await this.pollCaptionRegion();
    if (region) {
      this.lastKnownRegion = region;
    } else {
      console.warn("[MCS] stealth: caption region not found within 5s — will show when it appears");
    }

    this.attachCcInterceptor();
    this.installCaptionWatchdog();
    chrome.storage.onChanged.addListener(this.storageListener);
    this.installCcRemountObserver();
  }

  deactivate(): void {
    this.hadSuccessfulEnsure = false;
    this.removeHideStylesheet();
    this.detachCcInterceptor();
    this.teardownCaptionWatchdog();
    this.teardownCcRemountObserver();
    chrome.storage.onChanged.removeListener(this.storageListener);
    if (this.reenableTimer !== null) {
      clearTimeout(this.reenableTimer);
      this.reenableTimer = null;
    }
    this.lastKnownRegion = null;
    this.active = false;
    this.captionHiddenByUs = true;
  }

  isCaptionVisible(): boolean {
    if (!this.active) {
      return true;
    }
    return !this.captionHiddenByUs;
  }

  toggleCaptionVisibility(): void {
    if (!this.active) {
      return;
    }
    if (this.captionHiddenByUs) {
      this.removeHideStylesheet();
      this.captionHiddenByUs = false;
    } else {
      this.applyHideStylesheet();
      this.captionHiddenByUs = true;
    }
  }

  destroy(): void {
    this.deactivate();
  }

  private readonly onCcClickCapture = (event: Event): void => {
    if (!this.active) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    event.stopImmediatePropagation();
    this.showCcBlockedFeedback();
  };

  private showCcBlockedFeedback(): void {
    if (!this.ccButton) {
      return;
    }
    const originalTitle = this.ccButton.getAttribute("data-tooltip") || this.ccButton.getAttribute("aria-label") || "";
    this.ccButton.setAttribute("data-tooltip", CC_DISABLED_TOOLTIP);
    this.ccButton.setAttribute("aria-label", CC_DISABLED_TOOLTIP);
    
    window.setTimeout(() => {
      if (this.ccButton && this.active) {
        this.ccButton.setAttribute("data-tooltip", originalTitle);
        this.ccButton.setAttribute("aria-label", originalTitle);
      }
    }, 2000);
  }

  private async pollCaptionRegion(): Promise<Element | null> {
    for (let i = 0; i < REGION_POLL_MAX_ATTEMPTS; i += 1) {
      const el = findCaptionRegion(this.doc);
      if (el) {
        return el;
      }
      await sleep(REGION_POLL_MS);
    }
    return null;
  }

  private applyHideStylesheet(): void {
    this.doc.getElementById(STEALTH_STYLE_ID)?.remove();
    const style = this.doc.createElement("style");
    style.id = STEALTH_STYLE_ID;
    style.textContent = HIDE_CSS;
    this.doc.head.appendChild(style);
    this.hideStyleEl = style;
  }

  private removeHideStylesheet(): void {
    this.doc.getElementById(STEALTH_STYLE_ID)?.remove();
    this.hideStyleEl = null;
  }

  private attachCcInterceptor(): void {
    this.detachCcInterceptor();
    const btn = findCaptionToggleButton(this.doc);
    if (!btn) {
      return;
    }
    this.ccButton = btn;
    btn.addEventListener("click", this.onCcClickCapture, true);
  }

  private detachCcInterceptor(): void {
    if (this.ccButton) {
      this.ccButton.removeEventListener("click", this.onCcClickCapture, true);
    }
    this.ccButton = null;
  }

  private installCcRemountObserver(): void {
    this.teardownCcRemountObserver();
    this.ccRemountObserver = new MutationObserver(() => {
      if (!this.active) {
        return;
      }
      if (this.ccRemountDebounce !== null) {
        clearTimeout(this.ccRemountDebounce);
      }
      this.ccRemountDebounce = window.setTimeout(() => {
        this.ccRemountDebounce = null;
        if (!this.active) {
          return;
        }
        if (this.ccButton && this.ccButton.isConnected) {
          return;
        }
        this.attachCcInterceptor();
      }, WATCHDOG_DEBOUNCE_MS);
    });
    this.ccRemountObserver.observe(this.doc.body, { childList: true, subtree: true });
  }

  private teardownCcRemountObserver(): void {
    if (this.ccRemountDebounce !== null) {
      clearTimeout(this.ccRemountDebounce);
      this.ccRemountDebounce = null;
    }
    if (this.ccRemountObserver) {
      this.ccRemountObserver.disconnect();
      this.ccRemountObserver = null;
    }
  }

  private installCaptionWatchdog(): void {
    this.teardownCaptionWatchdog();
    this.captionWatchdog = new MutationObserver(() => {
      if (!this.active) {
        return;
      }
      if (this.watchdogDebounce !== null) {
        clearTimeout(this.watchdogDebounce);
      }
      this.watchdogDebounce = window.setTimeout(() => {
        this.watchdogDebounce = null;
        void this.runCaptionWatchdogCheck();
      }, WATCHDOG_DEBOUNCE_MS);
    });
    this.captionWatchdog.observe(this.doc.body, { childList: true, subtree: true });
  }

  private teardownCaptionWatchdog(): void {
    if (this.watchdogDebounce !== null) {
      clearTimeout(this.watchdogDebounce);
      this.watchdogDebounce = null;
    }
    if (this.captionWatchdog) {
      this.captionWatchdog.disconnect();
      this.captionWatchdog = null;
    }
  }

  private async runCaptionWatchdogCheck(): Promise<void> {
    if (!this.active) {
      return;
    }

    const current = findCaptionRegion(this.doc);
    if (current) {
      this.lastKnownRegion = current;
    }

    const meetSaysOff = (await this.adapter.detectCaptionState()).enabled === false;
    const hadDisconnected = this.lastKnownRegion !== null && !this.lastKnownRegion.isConnected;
    const regionGone = hadDisconnected || (this.hadSuccessfulEnsure && meetSaysOff);

    if (!regionGone) {
      return;
    }

    if (this.reenableTimer !== null) {
      clearTimeout(this.reenableTimer);
    }
    this.reenableTimer = window.setTimeout(() => {
      this.reenableTimer = null;
      void this.reenableAfterCaptionLoss();
    }, REENABLE_DELAY_MS);
  }

  private async reenableAfterCaptionLoss(): Promise<void> {
    if (!this.active) {
      return;
    }
    console.info("[MCS] stealth: caption region lost or disabled — re-enabling captions");
    this.lastKnownRegion = null;
    const ok = await this.adapter.ensureCaptionsEnabled();
    if (!ok) {
      console.warn("[MCS] stealth: re-enable failed");
      return;
    }
    const region = await this.pollCaptionRegion();
    if (region) {
      this.lastKnownRegion = region;
    }
  }

  private async onSessionStorageChanged(): Promise<void> {
    if (!this.hadSuccessfulEnsure) {
      return;
    }
    const session = await getSessionState();
    if (!session.isCaptureRunning) {
      return;
    }
    const snap = await this.adapter.detectCaptionState();
    if (snap.enabled === false) {
      console.info("[MCS] stealth: session storage changed while capture running — captions off in DOM, re-enabling");
      await this.reenableAfterCaptionLoss();
    }
  }
}
