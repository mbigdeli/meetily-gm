import type { CaptionSnapshot } from "./types.js";

/** Stable hash for dedupe (short, not cryptographic). */
export function hashCaptionKey(text: string, speaker: string | null): string {
  const s = `${text.trim()}|${speaker ?? ""}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Split "Name: rest" or first line as speaker hint.
 * Kept for backwards compatibility; not used in the primary extraction path.
 */
export function splitSpeakerHint(text: string): { speakerHint: string | null; line: string } {
  const trimmed = text.trim();
  const lines = trimmed
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const first = lines[0];
    const rest = lines.slice(1).join(" ");
    if (first.length < 96 && rest.length > 0) {
      const noColon = first.replace(/:\s*$/, "");
      if (noColon.length > 0 && noColon.length < 80) {
        return { speakerHint: noColon, line: rest };
      }
    }
  }
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0 && colonIdx < 72) {
    const hint = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (hint.length > 0 && rest.length > 0 && hint.length < 80) {
      return { speakerHint: hint, line: rest };
    }
  }
  return { speakerHint: null, line: trimmed };
}

/**
 * Finds Google Meet's stable live-caption region.
 *
 * Meet renders captions inside `div[role="region"][tabindex="0"]` — an ARIA
 * container whose role and tabindex are accessibility requirements that Google
 * keeps stable across UI redesigns. This avoids any dependency on obfuscated
 * class names (e.g. `.nMcdL`, `.ygicle`) that change with every deploy.
 *
 * Selection criteria (all must be true):
 *   1. Matches `div[role="region"][tabindex="0"]`
 *   2. Has a positive rendered height (i.e. visible)
 *   3. Has at least one child element
 *   4. Contains at least one `img` element (speaker avatar — always present in caption blocks)
 */
export function findCaptionRegion(doc: Document): Element | null {
  const candidates = doc.querySelectorAll('div[role="region"][tabindex="0"]');
  console.debug(`[MCS] findCaptionRegion: ${candidates.length} candidate(s) found`);
  for (const el of Array.from(candidates)) {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) {
      console.debug("[MCS] findCaptionRegion: skipped (height=0, captions may be off)");
      continue;
    }
    if (el.children.length === 0) continue;
    if (!el.querySelector("img")) continue;
    console.info("[MCS] findCaptionRegion: caption region attached ✓");
    return el;
  }
  return null;
}

/**
 * Extracts a caption snapshot from the Meet caption region.
 *
 * Does NOT use class names. Relies only on the stable DOM structure of each
 * caption block, which has been consistent across Meet UI versions:
 *
 *   div[role="region"][tabindex="0"]        ← region
 *     div                                   ← caption block (one per utterance)
 *       div  [speaker section]              ← children[0]
 *         img[alt=""]                       ← decorative avatar (contributes nothing to textContent)
 *         div > span "Speaker Name"         ← the only text in this section
 *       div  [caption text]                 ← children[last]
 *         "Live caption text here"
 *     div  ...                              ← older utterances or non-transcript elements
 *
 * Caption blocks are identified as direct children of the region that contain
 * an img element. The last such block is the currently active utterance.
 */
export function extractFromRegion(region: Element): CaptionSnapshot {
  const captionBlocks = Array.from(region.children).filter(
    (child) => child.querySelector("img") !== null,
  );

  if (captionBlocks.length === 0) {
    return { captionText: "", speakerHint: null, domSignature: null };
  }

  const lastBlock = captionBlocks[captionBlocks.length - 1]!;
  const blockChildren = Array.from(lastBlock.children);

  if (blockChildren.length < 2) {
    return { captionText: "", speakerHint: null, domSignature: null };
  }

  // children[0] = speaker section. img[alt=""] contributes nothing to textContent,
  // so the remaining text is purely the speaker's display name.
  const rawSpeaker = (blockChildren[0]!.textContent ?? "").trim();
  const speakerHint = rawSpeaker.length > 0 && rawSpeaker.length < 80 ? rawSpeaker : null;

  // children[last] = caption text div.
  const captionText = (blockChildren[blockChildren.length - 1]!.textContent ?? "").trim();

  if (captionText.length < 2) {
    return { captionText: "", speakerHint: null, domSignature: null };
  }

  console.debug(`[MCS] caption: speaker="${speakerHint ?? "(none)"}" text="${captionText.slice(0, 60)}${captionText.length > 60 ? "…" : ""}"`);

  const raw = lastBlock.outerHTML;
  const domSignature = raw.length > 240 ? raw.slice(0, 240) : raw;
  return { captionText, speakerHint, domSignature };
}

/**
 * Reads the live caption snapshot from Google Meet's DOM.
 *
 * Primary strategy: find `div[role="region"][tabindex="0"]` (ARIA-stable) and
 * extract speaker + text via structural DOM traversal — no class names.
 *
 * Returns an empty snapshot when the region is absent or not yet visible
 * (e.g. captions are off, or Meet hasn't rendered the region yet).
 */
export function extractCaptionSnapshot(doc: Document): CaptionSnapshot {
  const region = findCaptionRegion(doc);
  if (region) {
    return extractFromRegion(region);
  }
  return { captionText: "", speakerHint: null, domSignature: null };
}

const GROWTH_THRESHOLD = 10;

export class CaptionDedupeState {
  private lastEmittedText = "";
  private lastSpeakerHint: string | null = null;
  private lastEmitAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  /** Returns true when this snapshot should be emitted as a new caption line. */
  shouldEmit(snapshot: CaptionSnapshot): boolean {
    const current = snapshot.captionText.trim();
    if (current.length < 2) {
      return false;
    }

    if (current === this.lastEmittedText && snapshot.speakerHint === this.lastSpeakerHint) {
      return false;
    }

    const currentKey = hashCaptionKey(current, snapshot.speakerHint);
    const lastKey = hashCaptionKey(this.lastEmittedText, this.lastSpeakerHint);

    if (currentKey !== lastKey) {
      const isGrowing =
        current.startsWith(this.lastEmittedText) &&
        current.length >= this.lastEmittedText.length + GROWTH_THRESHOLD;
      if (isGrowing) {
        const now = Date.now();
        if (now - this.lastEmitAt < this.minIntervalMs) {
          return false;
        }
      }
      this.lastEmittedText = current;
      this.lastSpeakerHint = snapshot.speakerHint;
      this.lastEmitAt = Date.now();
      return true;
    }

    return false;
  }

  reset(): void {
    this.lastEmittedText = "";
    this.lastSpeakerHint = null;
    this.lastEmitAt = 0;
  }
}

export interface ConsolidatedLine {
  speaker: string | null;
  text: string;
}

/**
 * Consolidates Google Meet's incremental live captions into ONE line per
 * speaker turn. Meet re-emits the same utterance repeatedly as it grows
 * ("hi" -> "hi there" -> "hi there team"); feeding every growth to meetily
 * produced a very repetitive transcript. This holds the growing text for the
 * current turn and returns a finalized line only when the turn ends (speaker
 * change, or the text diverges into a new sentence). Call flush() at teardown
 * to emit the final in-progress turn.
 */
export class CaptionConsolidator {
  private speaker: string | null = null;
  private text = "";

  private norm(s: string | null): string {
    return (s ?? "").trim();
  }

  /** Feed a caption snapshot. Returns a finalized line when a turn boundary is crossed, else null. */
  process(snapshot: CaptionSnapshot): ConsolidatedLine | null {
    const t = snapshot.captionText.trim();
    if (t.length < 2) return null;
    const s = snapshot.speakerHint;

    if (this.text === "") {
      this.speaker = s;
      this.text = t;
      return null;
    }

    // A transiently-missing speaker (avatar/name not yet rendered on this
    // snapshot, on either side) must NOT be read as a speaker change — an
    // unknown speaker matches anything, else one turn is split and mislabeled
    // as "(none)". The related-text check below guards against false merges.
    const sameSpeaker =
      s == null || this.speaker == null || this.norm(s) === this.norm(this.speaker);
    const related = this.isSameTurn(this.text, t);

    if (sameSpeaker && related) {
      // Same turn. Adopt the new text on growth ("hi" -> "hi there") and on an
      // in-place correction ("…the world" -> "…the word"); only keep the current
      // text when the new snapshot is a strict prefix of it (a transient shorter
      // render), so we never regress to less content.
      if (!this.text.startsWith(t)) {
        this.text = t;
      }
      // Fill in the speaker name once it finally renders.
      if (s != null && this.speaker == null) this.speaker = s;
      return null;
    }

    // Turn boundary (speaker changed, or text diverged into a new sentence):
    // finalize the previous turn and begin a new one.
    const done: ConsolidatedLine = { speaker: this.speaker, text: this.text };
    this.speaker = s;
    this.text = t;
    return done;
  }

  /**
   * Same speaker turn if one string extends the other (Meet growing the caption)
   * OR they share a dominant common prefix (Meet revising a trailing word in
   * place: "…the world" -> "…the word"). Without the prefix tolerance an
   * in-place correction is misread as a new turn and the line is duplicated.
   */
  private isSameTurn(a: string, b: string): boolean {
    if (b.startsWith(a) || a.startsWith(b)) return true;
    const min = Math.min(a.length, b.length);
    if (min === 0) return false;
    let i = 0;
    while (i < min && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i >= Math.max(8, Math.floor(min * 0.8));
  }

  /** Emit the current in-progress turn (call on teardown / meeting end). */
  flush(): ConsolidatedLine | null {
    if (this.text.trim().length < 2) {
      this.reset();
      return null;
    }
    const done: ConsolidatedLine = { speaker: this.speaker, text: this.text };
    this.reset();
    return done;
  }

  reset(): void {
    this.speaker = null;
    this.text = "";
  }
}
