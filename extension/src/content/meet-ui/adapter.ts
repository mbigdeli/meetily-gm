import type { LiveCaptionLanguage } from "../../shared/types.js";
import type { CaptionSnapshot, MeetDomAdapter } from "./types.js";

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

const CAPTION_TOGGLE_PATTERNS = ["turn on captions", "turn off captions", "captions", "subtitles"];
const CAPTION_SECTION_PATTERNS = ["caption settings", "subtitle settings", "captions", "subtitles"];
const MORE_OPTIONS_PATTERNS = ["more options", "more"];
const SETTINGS_PATTERNS = ["settings"];
const LANGUAGE_TRIGGER_PATTERNS = [
  "caption language",
  "meeting language",
  "spoken language",
  "subtitle language",
];
const ENGLISH_PATTERNS = ["english"];
const PERSIAN_PATTERNS = ["persian", "farsi"];

interface InteractiveSearchContext {
  interactiveCache: WeakMap<ParentNode, HTMLElement[]>;
}

export class GoogleMeetDomAdapter implements MeetDomAdapter {
  constructor(private readonly doc: Document) {}

  detectMeetReady(): boolean {
    if (this.doc.location.hostname !== "meet.google.com") {
      return false;
    }
    return Boolean(this.doc.body && (this.findCaptionToggleButton() || this.doc.querySelector("main")));
  }

  async detectCaptionState(): Promise<CaptionSnapshot> {
    const searchContext = this.createSearchContext();
    const toggle = this.findCaptionToggleButton(searchContext);
    const language = await this.confirmCaptionLanguageWithContext(searchContext);
    let enabled: boolean | null = null;

    if (toggle) {
      const toggleText = textForElement(toggle);
      const ariaPressed = toggle.getAttribute("aria-pressed");
      if (ariaPressed === "true") {
        enabled = true;
      } else if (ariaPressed === "false") {
        enabled = false;
      } else if (toggleText.includes("turn off captions")) {
        enabled = true;
      } else if (toggleText.includes("turn on captions")) {
        enabled = false;
      }
    }

    return { enabled, language };
  }

  async ensureCaptionsEnabled(): Promise<boolean> {
    const current = await this.detectCaptionState();
    if (current.enabled === true) {
      return true;
    }

    const toggle = this.findCaptionToggleButton();
    if (!toggle) {
      return false;
    }

    clickElement(toggle);
    await sleep(200);
    const afterToggle = await this.detectCaptionState();
    return afterToggle.enabled === true || afterToggle.language !== null;
  }

  async openCaptionControls(): Promise<boolean> {
    if (this.findLanguageOption("fa") || this.findLanguageOption("en")) {
      return true;
    }

    const directTrigger = this.findLanguageTrigger();
    if (directTrigger) {
      clickElement(directTrigger);
      await sleep(150);
      return Boolean(this.findLanguageOption("fa") || this.findLanguageOption("en"));
    }

    const captionSettings = this.findMatchingInteractive(this.doc, CAPTION_SECTION_PATTERNS, (element) =>
      hasRole(element, ["button", "tab", "menuitem"]),
    );
    if (captionSettings) {
      clickElement(captionSettings);
      await sleep(150);
      const languageTrigger = this.findLanguageTrigger();
      if (languageTrigger) {
        clickElement(languageTrigger);
        await sleep(150);
      }
      if (this.findLanguageOption("fa") || this.findLanguageOption("en")) {
        return true;
      }
    }

    const moreOptions = this.findMatchingInteractive(this.doc, MORE_OPTIONS_PATTERNS);
    if (moreOptions) {
      clickElement(moreOptions);
      await sleep(150);
      const settings = this.findMatchingInteractive(this.doc, SETTINGS_PATTERNS);
      if (settings) {
        clickElement(settings);
        await sleep(250);
        const captionsTab = this.findMatchingInteractive(this.doc, CAPTION_SECTION_PATTERNS, (element) =>
          hasRole(element, ["tab", "button", "menuitem"]),
        );
        if (captionsTab) {
          clickElement(captionsTab);
          await sleep(150);
        }
        const languageTrigger = this.findLanguageTrigger();
        if (languageTrigger) {
          clickElement(languageTrigger);
          await sleep(150);
        }
      }
    }

    return Boolean(this.findLanguageOption("fa") || this.findLanguageOption("en"));
  }

  async setCaptionLanguageFA(): Promise<boolean> {
    return this.selectCaptionLanguage("fa");
  }

  async setCaptionLanguageEN(): Promise<boolean> {
    return this.selectCaptionLanguage("en");
  }

  async confirmCaptionLanguage(): Promise<LiveCaptionLanguage | null> {
    return this.confirmCaptionLanguageWithContext(this.createSearchContext());
  }

  private async confirmCaptionLanguageWithContext(
    searchContext: InteractiveSearchContext,
  ): Promise<LiveCaptionLanguage | null> {
    for (const root of this.overlayRoots()) {
      const selectedOption = this.getInteractiveElements(root, searchContext).find((element) =>
        isSelectedElement(element),
      );
      const selectedLanguage = detectLanguageFromText(textForElement(selectedOption ?? null));
      if (selectedLanguage) {
        return selectedLanguage;
      }
    }

    const trigger = this.findLanguageTrigger(searchContext);
    if (trigger) {
      const triggerLanguage = detectLanguageFromText(textForElement(trigger));
      if (triggerLanguage) {
        return triggerLanguage;
      }
    }

    return null;
  }

  private async selectCaptionLanguage(language: LiveCaptionLanguage): Promise<boolean> {
    if (!(await this.openCaptionControls())) {
      return false;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const option = this.findLanguageOption(language);
      if (option) {
        clickElement(option);
        await sleep(150);
        return true;
      }
      await sleep(150);
    }

    return false;
  }

  private findCaptionToggleButton(searchContext?: InteractiveSearchContext): HTMLElement | null {
    return this.findMatchingInteractive(
      this.doc,
      CAPTION_TOGGLE_PATTERNS,
      (element, text) => {
        if (!hasRole(element, ["button"])) {
          return false;
        }
        return text.includes("caption") || text.includes("subtitle");
      },
      searchContext,
    );
  }

  private findLanguageTrigger(searchContext?: InteractiveSearchContext): HTMLElement | null {
    for (const root of this.overlayRoots()) {
      const trigger = this.findMatchingInteractive(
        root,
        LANGUAGE_TRIGGER_PATTERNS,
        (element) => hasRole(element, ["button", "combobox", "tab", "menuitem"]),
        searchContext,
      );
      if (trigger) {
        return trigger;
      }
    }
    return null;
  }

  private findLanguageOption(
    language: LiveCaptionLanguage,
    searchContext?: InteractiveSearchContext,
  ): HTMLElement | null {
    const patterns = language === "fa" ? PERSIAN_PATTERNS : ENGLISH_PATTERNS;

    for (const root of this.overlayRoots()) {
      const exactRoleMatch = this.findMatchingInteractive(
        root,
        patterns,
        (element) => hasRole(element, ["menuitemradio", "radio", "option", "button"]),
        searchContext,
      );
      if (exactRoleMatch) {
        return exactRoleMatch;
      }
    }

    return null;
  }

  private overlayRoots(): ParentNode[] {
    const roots: ParentNode[] = [];
    const overlays = this.doc.querySelectorAll("[role='dialog'], [role='menu'], [aria-modal='true']");
    overlays.forEach((overlay) => {
      if (overlay instanceof HTMLElement && isVisible(overlay)) {
        roots.push(overlay);
      }
    });
    roots.push(this.doc);
    return roots;
  }

  private findMatchingInteractive(
    root: ParentNode,
    patterns: readonly string[],
    predicate?: (element: HTMLElement, text: string) => boolean,
    searchContext?: InteractiveSearchContext,
  ): HTMLElement | null {
    return (
      this.getInteractiveElements(root, searchContext).find((element) => {
        const text = textForElement(element);
        const matchesPattern = patterns.some((pattern) => text.includes(pattern));
        return matchesPattern && (predicate ? predicate(element, text) : true);
      }) ?? null
    );
  }

  private createSearchContext(): InteractiveSearchContext {
    return { interactiveCache: new WeakMap() };
  }

  private getInteractiveElements(
    root: ParentNode,
    searchContext?: InteractiveSearchContext,
  ): HTMLElement[] {
    if (!searchContext) {
      return interactiveElements(root);
    }
    const cached = searchContext.interactiveCache.get(root);
    if (cached) {
      return cached;
    }
    const visibleElements = interactiveElements(root);
    searchContext.interactiveCache.set(root, visibleElements);
    return visibleElements;
  }
}

export function detectLanguageFromText(text: string): LiveCaptionLanguage | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  if (ENGLISH_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "en";
  }
  if (PERSIAN_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "fa";
  }
  return null;
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

function interactiveElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)).filter(isVisible);
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

function clickElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.click();
}

function isSelectedElement(element: HTMLElement): boolean {
  return (
    element.getAttribute("aria-selected") === "true" ||
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("data-selected") === "true" ||
    element.dataset.selected === "true"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
