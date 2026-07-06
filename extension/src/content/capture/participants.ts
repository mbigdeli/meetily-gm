import type { ParticipantItemRequest } from "../../shared/ingestTypes.js";

export function normalizeParticipantName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

const MATERIAL_ICON_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
// Matches a string whose leading token is a Material Icons glyph immediately
// followed by an uppercase letter — e.g. "visual_effectsBackgrounds and effects"
// or "frame_personYou're continuously framed". Meet's button/label text always
// begins with a capital; pure icon strings (e.g. "visual_effects") never do.
const ICON_CONCAT_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+[A-Z]/;
const NOTIFICATION_PHRASES = [
  "continuously framed",
  "pinned",
  "spotlighted",
  "you're",
  "you are",
  "backgrounds and effects",
];

export function looksLikeIconGlyph(text: string): boolean {
  return MATERIAL_ICON_PATTERN.test(text.trim());
}

export function looksLikeIconConcatenation(text: string): boolean {
  return ICON_CONCAT_PATTERN.test(text.trim());
}

export function looksLikeNotification(text: string): boolean {
  const lower = text.toLowerCase();
  return NOTIFICATION_PHRASES.some((phrase) => lower.includes(phrase));
}

function isNameCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (looksLikeIconGlyph(t)) return false;
  if (looksLikeIconConcatenation(t)) return false;
  if (looksLikeNotification(t)) return false;
  return true;
}

function textFromTile(tile: Element): string | null {
  // Priority 1: aria-label on the tile root (most reliable)
  const aria = tile.getAttribute("aria-label");
  if (aria) {
    const raw = aria.trim();
    if (raw.length > 0 && raw.length <= 100) {
      const m = raw.match(/^(.+?)(?:\s*\(|,|\n)/);
      const candidate = (m?.[1] ?? raw).trim();
      if (isNameCandidate(candidate)) {
        return candidate;
      }
    }
  }

  // Priority 2: img[alt] inside the tile (avatar image alt text is typically the name)
  const img = tile.querySelector("img[alt]");
  const alt = img?.getAttribute("alt");
  if (alt) {
    const candidate = alt.trim();
    if (isNameCandidate(candidate)) {
      return candidate;
    }
  }

  // Priority 3: first name-like span (filtered to exclude icon glyphs and notifications)
  const spans = Array.from(tile.querySelectorAll("span"));
  for (const span of spans) {
    const t = (span.textContent ?? "").trim();
    if (!isNameCandidate(t)) continue;
    if (span.getBoundingClientRect().height <= 0) continue;
    return t;
  }

  return null;
}

/**
 * Best-effort participant list from Meet tiles / roster.
 */
export function extractParticipants(doc: Document): ParticipantItemRequest[] {
  const seen = new Set<string>();
  const out: ParticipantItemRequest[] = [];
  const tiles = doc.querySelectorAll("[data-participant-id], [data-requested-participant-id]");
  tiles.forEach((tile) => {
    const name = textFromTile(tile);
    if (!name) {
      return;
    }
    const key = normalizeParticipantName(name);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({
      display_name: name,
      normalized_name: normalizeParticipantName(name),
      ui_source: "meet_tile",
      confidence: 0.5,
    });
  });

  if (out.length > 0) {
    return out;
  }

  doc.querySelectorAll("[role='listitem']").forEach((li) => {
    const t = li.textContent?.trim();
    if (!t || t.length < 2 || t.length > 120) {
      return;
    }
    if (!/[a-zA-Z\u0600-\u06FF]/.test(t)) {
      return;
    }
    const key = normalizeParticipantName(t);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({
      display_name: t,
      normalized_name: key,
      ui_source: "meet_listitem",
      confidence: 0.25,
    });
  });

  return out;
}
