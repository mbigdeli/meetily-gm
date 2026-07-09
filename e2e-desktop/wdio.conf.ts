// Desktop e2e (smoke only) — WebdriverIO + @wdio/tauri-service, the current
// official Tauri 2 path. This is a SCAFFOLD: install deps before first run:
//   npm i -D @wdio/cli @wdio/local-runner @wdio/mocha-framework \
//            @wdio/tauri-service webdriverio
//   npx tauri build --debug --no-bundle   # produces the binary below
// Runs nightly / pre-release on windows-latest, NOT per-PR (build cost +
// @wdio/tauri-service is pre-1.0). See .claude/skills/testing-e2e/SKILL.md.
import path from "node:path";

const isWin = process.platform === "win32";
const bin = path.resolve(
  __dirname,
  "..",
  "frontend/src-tauri/target/debug",
  isWin ? "meetily.exe" : "meetily",
);

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [{ "tauri:options": { application: bin } } as WebdriverIO.Capabilities],
  services: [
    // Embedded WebDriver provider; on Windows auto-download the msedgedriver
    // that matches the bundled WebView2 (the #1 flakiness fix).
    ["tauri", { autoDownloadEdgeDriver: true }],
  ],
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  logLevel: "warn",
};
