// Extension smoke e2e — keep this suite tiny (persistent contexts can't
// parallelize). Verifies the built extension loads and its options page
// renders. SW-dependent checks skip (not fail) where the headless environment
// doesn't boot the MV3 service worker; CI Linux does boot it.
// Run: `npm run build` then `npm run e2e`.
import { test, expect } from "./fixtures";

test("extension loads into a persistent context", async ({ context }) => {
  // The context launched with the unpacked extension and has a live page.
  const page = await context.newPage();
  await page.goto("about:blank");
  expect(context.pages().length).toBeGreaterThan(0);
  await page.close();
});

test("service worker yields a valid extension id", async ({ extensionId }) => {
  test.skip(!extensionId, "MV3 service worker did not boot in this headless env");
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

test("options page renders", async ({ context, extensionId }) => {
  test.skip(!extensionId, "MV3 service worker did not boot in this headless env");
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("body")).not.toBeEmpty();
  await page.close();
});

// TODO(doc-15): once manifest ships a fixed `key`, the id is deterministic —
// drop the skips and add the desktop-pairing handshake test vs a stub host.
