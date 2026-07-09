// Playwright fixtures for MV3 extension e2e.
// Loads the built extension in a persistent context (the only mode that
// supports extensions) using Playwright's default bundled Chromium, whose
// "new headless" supports MV3 extensions — no channel needed.
// See .claude/skills/testing-e2e/SKILL.md.
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string | null;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  // MV3 background service worker → its URL host is the extension id. Some
  // headless environments don't boot the SW; return null so tests can skip
  // rather than hang/fail on an environment limitation (CI Linux boots it).
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    for (let i = 0; !sw && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      [sw] = context.serviceWorkers();
    }
    await use(sw ? sw.url().split("/")[2] : null);
  },
});

export const expect = test.expect;
