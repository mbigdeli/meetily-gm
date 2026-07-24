#!/usr/bin/env node
// File-length gate (Miting convention: new source files stay small).
//
// Honest note: 120 lines is deliberately stricter than mainstream norms
// (ESLint `max-lines` defaults to 300). We apply it only to files that are
// ADDED or MODIFIED in this PR/commit, and exempt tests, generated code, and
// a grandfathered list of pre-existing large files (split-on-touch, not big-bang).
//
// Usage: node scripts/check-file-length.mjs  (run from repo root)

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const MAX = 120;
const EXT = /\.(rs|ts|tsx|js|mjs|jsx)$/;
const EXEMPT = [
  /(^|\/)tests?\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.d\.ts$/,
  /(^|\/)migrations\//,
  /(^|\/)node_modules\//,
  /(^|\/)target\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
];
// Pre-existing large files, exempt until next time they're touched.
// Pre-existing large files (pre-date the 120-line rule). Split on next touch;
// do not grow. Remove from this list once split.
const GRANDFATHERED = new Set([
  "frontend/src-tauri/src/audio/pipeline.rs",
  "frontend/src-tauri/src/database/manager.rs",
  "frontend/src-tauri/src/summary/processor.rs",
  "frontend/src-tauri/src/summary/service.rs",
  "frontend/src-tauri/src/gmeet_ingest/diarize.rs",
  "frontend/src-tauri/src/gmeet_ingest/mod.rs",
  "frontend/src-tauri/src/audio/playback_monitor.rs",
  "frontend/src/components/MeetingDetails/TranscriptPanel.tsx",
  "frontend/src/components/GmeetGraceController.tsx",
  "extension/src/shared/gmeetClient.ts",
  "frontend/src-tauri/src/codex/mod.rs",
  "frontend/src/components/ModelSettingsModal.tsx",
  "frontend/src/contexts/ConfigContext.tsx",
  "frontend/src-tauri/src/lib.rs",
  "frontend/src-tauri/src/claude_code/resolve.rs",
  "frontend/src-tauri/src/summary/llm_client.rs",
  "extension/src/background/index.ts",
  "frontend/src-tauri/src/audio/transcription/worker.rs",
  "frontend/src-tauri/src/whisper_engine/whisper_engine.rs",
]);

function changedFiles() {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "HEAD~1";
  try {
    const out = execSync(`git diff --name-only --diff-filter=AM ${base}...HEAD`, {
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // First commit / shallow clone: fall back to tracked files in this commit.
    const out = execSync("git show --name-only --pretty=format: HEAD", {
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

// "Excluding tests": for Rust, inline `#[cfg(test)]` modules don't count.
function countCode(file, src) {
  const lines = src.split("\n");
  if (file.endsWith(".rs")) {
    const testIdx = lines.findIndex((l) => l.trim().startsWith("#[cfg(test)]"));
    if (testIdx >= 0) return testIdx;
  }
  return lines.length;
}

const offenders = [];
for (const f of changedFiles()) {
  if (!EXT.test(f)) continue;
  if (EXEMPT.some((re) => re.test(f))) continue;
  if (GRANDFATHERED.has(f)) continue;
  if (!existsSync(f)) continue;
  const lines = countCode(f, readFileSync(f, "utf8"));
  if (lines > MAX) offenders.push(`${f}: ${lines} code lines (max ${MAX})`);
}

if (offenders.length) {
  console.error("File-length gate failed — split these files:");
  for (const o of offenders) console.error("  " + o);
  console.error(
    "\nIf a file is legitimately large and pre-existing, add it to GRANDFATHERED " +
      "in scripts/check-file-length.mjs (and plan to split it on next touch).",
  );
  process.exit(1);
}
console.log("File-length gate passed.");
