import { describe, expect, it } from "vitest";
import { buildWidgetViewModel } from "./widget.js";
import type { MeetWidgetState } from "./types.js";

function render(state: Partial<MeetWidgetState>) {
  return buildWidgetViewModel({
    mode: "ready",
    captionState: "unknown",
    currentLanguage: "unknown",
    message: "Waiting",
    busyLanguage: null,
    ...state,
  });
}

describe("buildWidgetViewModel", () => {
  it("renders unknown state labels", () => {
    const vm = render({});
    expect(vm.captionLabel).toBe("Unknown");
    expect(vm.languageLabel).toBe("Unknown");
    expect(vm.shellClassName).toBe("mcs-ready");
  });

  it("marks the active language button", () => {
    const vm = render({ currentLanguage: "fa", captionState: "on" });
    const fa = vm.buttons.find((button) => button.language === "fa");
    const en = vm.buttons.find((button) => button.language === "en");
    expect(fa?.active).toBe(true);
    expect(en?.active).toBe(false);
  });

  it("shows switching state as busy", () => {
    const vm = render({
      mode: "switching",
      busyLanguage: "en",
      message: "Switching...",
    });
    const en = vm.buttons.find((button) => button.language === "en");
    expect(vm.shellClassName).toBe("mcs-switching");
    expect(en?.busy).toBe(true);
    expect(vm.buttons.every((button) => button.disabled)).toBe(true);
  });

  it("keeps error state renderable for retries", () => {
    const vm = render({
      mode: "error",
      captionState: "off",
      message: "Could not confirm the language switch.",
    });
    expect(vm.shellClassName).toBe("mcs-error");
    expect(vm.captionLabel).toBe("Off");
    expect(vm.buttons.some((button) => button.disabled)).toBe(false);
  });
});
