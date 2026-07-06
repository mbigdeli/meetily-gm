import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/types.js";
import { validateSettingsForSave } from "./settingsValidation.js";

describe("validateSettingsForSave", () => {
  it("requires both storage roots", () => {
    const r = validateSettingsForSave({
      ...DEFAULT_SETTINGS,
      rawStorageRoot: "",
      finalOutputRoot: "C:\\out",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("Raw Storage Root"))).toBe(true);
    }
  });

  it("rejects invalid Windows path characters", () => {
    const r = validateSettingsForSave({
      ...DEFAULT_SETTINGS,
      rawStorageRoot: "C:\\ok\\path",
      finalOutputRoot: "C:\\bad<path",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts valid paths and trims", () => {
    const r = validateSettingsForSave({
      ...DEFAULT_SETTINGS,
      rawStorageRoot: "  C:\\raw  ",
      finalOutputRoot: "D:\\final",
      diarizationSpeakerCountHint: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.rawStorageRoot).toBe("C:\\raw");
      expect(r.settings.finalOutputRoot).toBe("D:\\final");
    }
  });

  it("rejects out-of-range speaker hint", () => {
    const r = validateSettingsForSave({
      ...DEFAULT_SETTINGS,
      rawStorageRoot: "C:\\a",
      finalOutputRoot: "C:\\b",
      diarizationSpeakerCountHint: 99,
    });
    expect(r.ok).toBe(false);
  });
});
