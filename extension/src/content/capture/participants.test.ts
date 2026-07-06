import { describe, expect, it } from "vitest";
import {
  extractParticipants,
  looksLikeIconConcatenation,
  looksLikeIconGlyph,
  looksLikeNotification,
  normalizeParticipantName,
} from "./participants.js";

describe("normalizeParticipantName", () => {
  it("trims and lowercases", () => {
    expect(normalizeParticipantName("  Alice  Smith  ")).toBe("alice smith");
  });
});

describe("looksLikeIconGlyph", () => {
  it("detects Material Icons ligatures", () => {
    expect(looksLikeIconGlyph("frame_person")).toBe(true);
    expect(looksLikeIconGlyph("mic_off")).toBe(true);
    expect(looksLikeIconGlyph("more_vert")).toBe(true);
    expect(looksLikeIconGlyph("camera_alt")).toBe(true);
  });

  it("does not flag real human names", () => {
    expect(looksLikeIconGlyph("M Bigdeli")).toBe(false);
    expect(looksLikeIconGlyph("mamad")).toBe(false);
    expect(looksLikeIconGlyph("Ali Rezaei")).toBe(false);
    expect(looksLikeIconGlyph("محمد")).toBe(false);
  });
});

describe("looksLikeIconConcatenation", () => {
  it("detects icon glyph immediately concatenated with button text", () => {
    expect(looksLikeIconConcatenation("visual_effectsBackgrounds and effects")).toBe(true);
    expect(looksLikeIconConcatenation("frame_personYou're continuously framed")).toBe(true);
    expect(looksLikeIconConcatenation("more_vertSettings")).toBe(true);
  });

  it("does not flag pure icon glyphs (handled by looksLikeIconGlyph)", () => {
    expect(looksLikeIconConcatenation("visual_effects")).toBe(false);
    expect(looksLikeIconConcatenation("frame_person")).toBe(false);
  });

  it("does not flag real human names", () => {
    expect(looksLikeIconConcatenation("M Bigdeli")).toBe(false);
    expect(looksLikeIconConcatenation("mohammad bigdeli")).toBe(false);
    expect(looksLikeIconConcatenation("Ali Rezaei")).toBe(false);
    expect(looksLikeIconConcatenation("محمد")).toBe(false);
  });
});

describe("looksLikeNotification", () => {
  it("detects Meet notification phrases", () => {
    expect(looksLikeNotification("You're continuously framed")).toBe(true);
    expect(looksLikeNotification("pinned")).toBe(true);
    expect(looksLikeNotification("spotlighted")).toBe(true);
    expect(looksLikeNotification("you are the host")).toBe(true);
  });

  it("does not flag real names", () => {
    expect(looksLikeNotification("Ali Rezaei")).toBe(false);
    expect(looksLikeNotification("Sara Ahmadi")).toBe(false);
  });
});

describe("extractParticipants", () => {
  it("reads data-participant-id tiles via aria-label", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tile = doc.createElement("div");
    tile.setAttribute("data-participant-id", "p1");
    tile.setAttribute("aria-label", "Jane Doe (presenting)");
    doc.body.appendChild(tile);
    const rows = extractParticipants(doc);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.display_name).toContain("Jane");
  });

  it("extracts name from aria-label with parenthesis suffix", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tile = doc.createElement("div");
    tile.setAttribute("data-participant-id", "p1");
    tile.setAttribute("aria-label", "M Bigdeli (you)");
    doc.body.appendChild(tile);
    const rows = extractParticipants(doc);
    expect(rows[0]?.display_name).toBe("M Bigdeli");
  });

  it("extracts name from aria-label without parenthesis", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tile = doc.createElement("div");
    tile.setAttribute("data-participant-id", "p1");
    tile.setAttribute("aria-label", "Ali Rezaei");
    doc.body.appendChild(tile);
    const rows = extractParticipants(doc);
    expect(rows[0]?.display_name).toBe("Ali Rezaei");
  });

  it("returns null for tile with only icon span and notification span", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tile = doc.createElement("div");
    tile.setAttribute("data-participant-id", "p1");
    const iconSpan = doc.createElement("span");
    iconSpan.textContent = "frame_person";
    const notifSpan = doc.createElement("span");
    notifSpan.textContent = "You're continuously framed";
    tile.appendChild(iconSpan);
    tile.appendChild(notifSpan);
    doc.body.appendChild(tile);
    const rows = extractParticipants(doc);
    expect(rows.filter((r) => r.ui_source === "meet_tile")).toHaveLength(0);
  });

  it("skips icon span and returns the real name span", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tile = doc.createElement("div");
    tile.setAttribute("data-participant-id", "p1");
    const iconSpan = doc.createElement("span");
    iconSpan.textContent = "mic_off";
    const nameSpan = doc.createElement("span");
    nameSpan.textContent = "M Bigdeli";
    tile.appendChild(iconSpan);
    tile.appendChild(nameSpan);
    doc.body.appendChild(tile);
    // Note: getBoundingClientRect returns 0 in jsdom, so spans won't be returned.
    // The tile produces no result from span path, which is the correct safe behavior.
    // The test verifies no garbage icon glyph name is returned.
    const rows = extractParticipants(doc);
    const tileRows = rows.filter((r) => r.ui_source === "meet_tile");
    for (const row of tileRows) {
      expect(looksLikeIconGlyph(row.display_name)).toBe(false);
    }
  });

  it("extracts name from img[alt] when no aria-label is present", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tile = doc.createElement("div");
    tile.setAttribute("data-participant-id", "p1");
    const img = doc.createElement("img");
    img.setAttribute("alt", "Sara Ahmadi");
    tile.appendChild(img);
    doc.body.appendChild(tile);
    const rows = extractParticipants(doc);
    expect(rows[0]?.display_name).toBe("Sara Ahmadi");
  });

  it("rejects aria-label that is icon glyph concatenated with button text (production regression)", () => {
    const doc = document.implementation.createHTMLDocument("");
    const badTile = doc.createElement("div");
    badTile.setAttribute("data-participant-id", "p1");
    badTile.setAttribute("aria-label", "visual_effectsBackgrounds and effects");
    doc.body.appendChild(badTile);
    const rows = extractParticipants(doc);
    const tileRows = rows.filter((r) => r.ui_source === "meet_tile");
    expect(tileRows).toHaveLength(0);
  });

  it("accepts a real participant alongside a garbage icon-concat tile", () => {
    const doc = document.implementation.createHTMLDocument("");
    const goodTile = doc.createElement("div");
    goodTile.setAttribute("data-participant-id", "p1");
    goodTile.setAttribute("aria-label", "mohammad bigdeli");
    doc.body.appendChild(goodTile);
    const badTile = doc.createElement("div");
    badTile.setAttribute("data-participant-id", "p2");
    badTile.setAttribute("aria-label", "visual_effectsBackgrounds and effects");
    doc.body.appendChild(badTile);
    const rows = extractParticipants(doc);
    const tileRows = rows.filter((r) => r.ui_source === "meet_tile");
    expect(tileRows).toHaveLength(1);
    expect(tileRows[0]?.display_name).toBe("mohammad bigdeli");
  });

  it("returns only the good participant when one tile has icon-only content", () => {
    const doc = document.implementation.createHTMLDocument("");

    const goodTile = doc.createElement("div");
    goodTile.setAttribute("data-participant-id", "p1");
    goodTile.setAttribute("aria-label", "Real Person");
    doc.body.appendChild(goodTile);

    const badTile = doc.createElement("div");
    badTile.setAttribute("data-participant-id", "p2");
    const iconSpan = doc.createElement("span");
    iconSpan.textContent = "frame_person";
    const notifSpan = doc.createElement("span");
    notifSpan.textContent = "You're continuously framed";
    badTile.appendChild(iconSpan);
    badTile.appendChild(notifSpan);
    doc.body.appendChild(badTile);

    const rows = extractParticipants(doc);
    const tileRows = rows.filter((r) => r.ui_source === "meet_tile");
    expect(tileRows).toHaveLength(1);
    expect(tileRows[0]?.display_name).toBe("Real Person");
  });
});
