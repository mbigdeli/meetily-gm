import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CaptionConsolidator,
  CaptionDedupeState,
  extractCaptionSnapshot,
  extractFromRegion,
  findCaptionRegion,
  hashCaptionKey,
  splitSpeakerHint,
} from "./caption-parser.js";

// ---------------------------------------------------------------------------
// splitSpeakerHint
// ---------------------------------------------------------------------------

describe("splitSpeakerHint", () => {
  it("splits name: text", () => {
    const r = splitSpeakerHint("Alice: hello world");
    expect(r.speakerHint).toBe("Alice");
    expect(r.line).toBe("hello world");
  });

  it("returns full line when no colon pattern", () => {
    const r = splitSpeakerHint("Just a caption line");
    expect(r.speakerHint).toBeNull();
    expect(r.line).toBe("Just a caption line");
  });
});

// ---------------------------------------------------------------------------
// hashCaptionKey
// ---------------------------------------------------------------------------

describe("hashCaptionKey", () => {
  it("is stable for same input", () => {
    expect(hashCaptionKey("hi", "Bob")).toBe(hashCaptionKey("hi", "Bob"));
  });

  it("differs when text changes", () => {
    expect(hashCaptionKey("hi", null)).not.toBe(hashCaptionKey("ho", null));
  });
});

// ---------------------------------------------------------------------------
// DOM helpers — build Meet-like caption DOM without class names
// ---------------------------------------------------------------------------

/**
 * Builds a Meet-style caption region:
 *   div[role="region"][tabindex="0"]
 *     div  (caption block)
 *       div  (speaker section: img[alt=""] + div > span "name")
 *       div  (caption text)
 */
function makeMeetCaptionDoc(
  blocks: Array<{ speaker: string; text: string }>,
  visible = true,
): Document {
  const doc = document.implementation.createHTMLDocument("");

  const region = doc.createElement("div");
  region.setAttribute("role", "region");
  region.setAttribute("tabindex", "0");
  region.setAttribute("aria-label", "Captions");

  if (visible) {
    region.getBoundingClientRect = () =>
      ({
        height: 120,
        width: 600,
        top: 700,
        bottom: 820,
        left: 0,
        right: 600,
        x: 0,
        y: 700,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  // invisible: default happy-dom returns height=0 automatically

  for (const block of blocks) {
    const captionBlock = doc.createElement("div");

    // Speaker section: img[alt=""] + inner div > span "name"
    const speakerSection = doc.createElement("div");
    const img = doc.createElement("img");
    img.setAttribute("alt", "");
    img.setAttribute("src", "https://lh3.googleusercontent.com/a/avatar");
    speakerSection.appendChild(img);
    const nameWrapper = doc.createElement("div");
    const nameSpan = doc.createElement("span");
    nameSpan.textContent = block.speaker;
    nameWrapper.appendChild(nameSpan);
    speakerSection.appendChild(nameWrapper);
    captionBlock.appendChild(speakerSection);

    // Caption text section
    const textDiv = doc.createElement("div");
    textDiv.textContent = block.text;
    captionBlock.appendChild(textDiv);

    region.appendChild(captionBlock);
  }

  doc.body.appendChild(region);
  return doc;
}

// ---------------------------------------------------------------------------
// findCaptionRegion
// ---------------------------------------------------------------------------

describe("findCaptionRegion", () => {
  it("finds a visible region with img children", () => {
    const doc = makeMeetCaptionDoc([{ speaker: "You", text: "Hello" }]);
    expect(findCaptionRegion(doc)).not.toBeNull();
  });

  it("returns null when document has no region", () => {
    const doc = document.implementation.createHTMLDocument("");
    expect(findCaptionRegion(doc)).toBeNull();
  });

  it("returns null when region has no img (not a caption region)", () => {
    const doc = document.implementation.createHTMLDocument("");
    const el = doc.createElement("div");
    el.setAttribute("role", "region");
    el.setAttribute("tabindex", "0");
    el.getBoundingClientRect = () =>
      ({ height: 40, width: 200, top: 0, bottom: 40, left: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    el.appendChild(doc.createElement("span"));
    doc.body.appendChild(el);
    expect(findCaptionRegion(doc)).toBeNull();
  });

  it("returns null when region is invisible (height=0)", () => {
    const doc = makeMeetCaptionDoc([{ speaker: "You", text: "Hello" }], false);
    expect(findCaptionRegion(doc)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFromRegion
// ---------------------------------------------------------------------------

describe("extractFromRegion", () => {
  it("extracts speaker and text from the last caption block", () => {
    const doc = makeMeetCaptionDoc([
      { speaker: "Alice", text: "First line." },
      { speaker: "You", text: "Second line, the active one." },
    ]);
    const region = findCaptionRegion(doc)!;
    const snap = extractFromRegion(region);
    expect(snap.captionText).toBe("Second line, the active one.");
    expect(snap.speakerHint).toBe("You");
  });

  it("extracts single block correctly", () => {
    const doc = makeMeetCaptionDoc([{ speaker: "Bob", text: "Testing the system now." }]);
    const region = findCaptionRegion(doc)!;
    const snap = extractFromRegion(region);
    expect(snap.captionText).toBe("Testing the system now.");
    expect(snap.speakerHint).toBe("Bob");
  });

  it("returns empty snapshot when region has no caption blocks", () => {
    const doc = document.implementation.createHTMLDocument("");
    const region = doc.createElement("div");
    region.setAttribute("role", "region");
    region.setAttribute("tabindex", "0");
    region.getBoundingClientRect = () =>
      ({ height: 40, width: 200, top: 0, bottom: 40, left: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    doc.body.appendChild(region);
    const snap = extractFromRegion(region);
    expect(snap.captionText).toBe("");
    expect(snap.speakerHint).toBeNull();
  });

  it("returns null speakerHint when speaker text is empty (img only, no name)", () => {
    const doc = document.implementation.createHTMLDocument("");
    const region = doc.createElement("div");
    region.setAttribute("role", "region");
    region.setAttribute("tabindex", "0");
    region.getBoundingClientRect = () =>
      ({ height: 40, width: 200, top: 0, bottom: 40, left: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const block = doc.createElement("div");
    const speakerDiv = doc.createElement("div");
    const img = doc.createElement("img");
    img.setAttribute("alt", "");
    speakerDiv.appendChild(img);
    block.appendChild(speakerDiv);
    const textDiv = doc.createElement("div");
    textDiv.textContent = "Some caption text here";
    block.appendChild(textDiv);
    region.appendChild(block);
    doc.body.appendChild(region);

    const snap = extractFromRegion(region);
    expect(snap.captionText).toBe("Some caption text here");
    expect(snap.speakerHint).toBeNull();
  });

  it("returns empty when caption text is too short (< 2 chars)", () => {
    const doc = makeMeetCaptionDoc([{ speaker: "You", text: "." }]);
    const region = findCaptionRegion(doc)!;
    const snap = extractFromRegion(region);
    expect(snap.captionText).toBe("");
  });

  it("populates domSignature", () => {
    const doc = makeMeetCaptionDoc([{ speaker: "You", text: "Hello world caption." }]);
    const region = findCaptionRegion(doc)!;
    const snap = extractFromRegion(region);
    expect(snap.domSignature).not.toBeNull();
    expect(snap.domSignature!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractCaptionSnapshot — full integration
// ---------------------------------------------------------------------------

describe("extractCaptionSnapshot", () => {
  it("returns caption from a visible Meet region", () => {
    const doc = makeMeetCaptionDoc([
      { speaker: "You", text: "Let's test this page and see what happens." },
    ]);
    const snap = extractCaptionSnapshot(doc);
    expect(snap.captionText).toBe("Let's test this page and see what happens.");
    expect(snap.speakerHint).toBe("You");
  });

  it("returns the last (active) utterance when multiple blocks exist", () => {
    const doc = makeMeetCaptionDoc([
      { speaker: "Alice", text: "I was speaking earlier." },
      { speaker: "Bob", text: "Now I am speaking, this is current." },
    ]);
    const snap = extractCaptionSnapshot(doc);
    expect(snap.captionText).toContain("Now I am speaking");
    expect(snap.speakerHint).toBe("Bob");
  });

  it("returns empty snapshot when document has no caption region", () => {
    const doc = document.implementation.createHTMLDocument("");
    const snap = extractCaptionSnapshot(doc);
    expect(snap.captionText).toBe("");
    expect(snap.speakerHint).toBeNull();
    expect(snap.domSignature).toBeNull();
  });

  it("returns empty snapshot when region is invisible (captions off)", () => {
    const doc = makeMeetCaptionDoc(
      [{ speaker: "You", text: "Hidden caption." }],
      false, // invisible
    );
    const snap = extractCaptionSnapshot(doc);
    expect(snap.captionText).toBe("");
  });

  it("handles Persian caption text correctly", () => {
    const doc = makeMeetCaptionDoc([
      { speaker: "شما", text: "تغییر زبان به فارسی برای تست سیستم." },
    ]);
    const snap = extractCaptionSnapshot(doc);
    expect(snap.captionText).toContain("فارسی");
    expect(snap.speakerHint).toBe("شما");
  });
});

// ---------------------------------------------------------------------------
// CaptionDedupeState
// ---------------------------------------------------------------------------

function snap(
  captionText: string,
  speakerHint: string | null = null,
): { captionText: string; speakerHint: string | null; domSignature: string } {
  return { captionText, speakerHint, domSignature: "sig" };
}

describe("CaptionDedupeState", () => {
  it("emits first occurrence, suppresses pure repeat", () => {
    const d = new CaptionDedupeState(10_000);
    expect(d.shouldEmit(snap("hello"))).toBe(true);
    expect(d.shouldEmit(snap("hello"))).toBe(false);
  });

  it("emits new utterance after a repeat", () => {
    const d = new CaptionDedupeState(10_000);
    expect(d.shouldEmit(snap("Hello"))).toBe(true);
    expect(d.shouldEmit(snap("Hello"))).toBe(false);
    expect(d.shouldEmit(snap("Goodbye"))).toBe(true);
  });

  it("suppresses growing utterance within throttle window when growth >= threshold", () => {
    vi.useFakeTimers();
    const d = new CaptionDedupeState(2_000);
    expect(d.shouldEmit(snap("Hello world"))).toBe(true);
    vi.advanceTimersByTime(500);
    expect(d.shouldEmit(snap("Hello world this is longer now text"))).toBe(false);
    vi.useRealTimers();
  });

  it("emits growing utterance after throttle window and sufficient length", () => {
    vi.useFakeTimers();
    const d = new CaptionDedupeState(2_000);
    expect(d.shouldEmit(snap("Hello world"))).toBe(true);
    vi.advanceTimersByTime(2_500);
    expect(d.shouldEmit(snap("Hello world and some more words now"))).toBe(true);
    vi.useRealTimers();
  });

  it("emits when speaker changes even if text is the same", () => {
    const d = new CaptionDedupeState(2_000);
    expect(d.shouldEmit(snap("Hello", "Alice"))).toBe(true);
    expect(d.shouldEmit(snap("Hello", "Bob"))).toBe(true);
  });

  it("resets state so previously suppressed text emits again", () => {
    const d = new CaptionDedupeState(10_000);
    expect(d.shouldEmit(snap("Hello"))).toBe(true);
    expect(d.shouldEmit(snap("Hello"))).toBe(false);
    d.reset();
    expect(d.shouldEmit(snap("Hello"))).toBe(true);
  });

  it("never emits for empty or whitespace-only text", () => {
    const d = new CaptionDedupeState(2_000);
    expect(d.shouldEmit(snap("  "))).toBe(false);
    expect(d.shouldEmit(snap(""))).toBe(false);
    expect(d.shouldEmit(snap("x"))).toBe(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// CaptionConsolidator — one line per speaker turn
// ---------------------------------------------------------------------------

describe("CaptionConsolidator", () => {
  it("holds a growing turn and emits nothing until a boundary", () => {
    const c = new CaptionConsolidator();
    expect(c.process(snap("Hi", "Alice"))).toBeNull();
    expect(c.process(snap("Hi there", "Alice"))).toBeNull();
    expect(c.process(snap("Hi there team", "Alice"))).toBeNull();
    // flush yields the single consolidated turn with the richest text.
    expect(c.flush()).toEqual({ speaker: "Alice", text: "Hi there team" });
  });

  it("emits the previous turn when the speaker changes", () => {
    const c = new CaptionConsolidator();
    c.process(snap("Hello everyone", "Alice"));
    const done = c.process(snap("My turn now", "Bob"));
    expect(done).toEqual({ speaker: "Alice", text: "Hello everyone" });
    expect(c.flush()).toEqual({ speaker: "Bob", text: "My turn now" });
  });

  it("does NOT split a turn when the speaker hint is transiently null (bug 8)", () => {
    const c = new CaptionConsolidator();
    expect(c.process(snap("I am talking", "Alice"))).toBeNull();
    // Avatar/name not rendered on this snapshot → speakerHint null, text growing.
    expect(c.process(snap("I am talking now", null))).toBeNull();
    // Name renders again; still the same turn.
    expect(c.process(snap("I am talking now for real", "Alice"))).toBeNull();
    expect(c.flush()).toEqual({ speaker: "Alice", text: "I am talking now for real" });
  });

  it("keeps the speaker name once it renders after a null-first snapshot", () => {
    const c = new CaptionConsolidator();
    expect(c.process(snap("Starting to speak", null))).toBeNull();
    expect(c.process(snap("Starting to speak clearly", "Carol"))).toBeNull();
    expect(c.flush()).toEqual({ speaker: "Carol", text: "Starting to speak clearly" });
  });

  it("treats an in-place trailing-word correction as the same turn (bug 10)", () => {
    const c = new CaptionConsolidator();
    expect(c.process(snap("hello there world", "Alice"))).toBeNull();
    // Meet revises the last word in place: "world" -> "word" (non-prefix).
    expect(c.process(snap("hello there word", "Alice"))).toBeNull();
    const line = c.flush();
    expect(line?.speaker).toBe("Alice");
    // Exactly one line, corrected — not two duplicated/overlapping lines.
    expect(line?.text).toBe("hello there word");
  });

  it("splits genuinely different short utterances by the same speaker", () => {
    const c = new CaptionConsolidator();
    c.process(snap("hello", "Alice"));
    const done = c.process(snap("goodbye", "Alice"));
    expect(done).toEqual({ speaker: "Alice", text: "hello" });
  });

  it("flush returns null and resets when no turn is in progress", () => {
    const c = new CaptionConsolidator();
    expect(c.flush()).toBeNull();
    c.process(snap("Something", "Alice"));
    c.reset();
    expect(c.flush()).toBeNull();
  });
});
