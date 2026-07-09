#!/usr/bin/env node
// Roll the OTA update channel back to a previous version.
//
// Tauri's updater installs whatever `latest.json` the `releases/latest`
// endpoint serves. To roll back a bad release we republish an OLDER version's
// latest.json as the current one; clients downgrade on their next check.
//
// Prereqs: `gh` CLI authenticated; the updater endpoint must point at OUR repo
// (done in M2 / doc 02 — until then this operates on whatever REPO is set).
//
// Usage:
//   node scripts/rollback-release.mjs --to v0.5.0 [--repo owner/name] [--dry-run]
//
// Pair with the DB backup restore runbook (.claude/skills/db-migrations) when
// the bad release also shipped a schema migration.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const to = flag("--to");
const repo = flag("--repo") || process.env.MITING_RELEASE_REPO || "mbigdeli/miting";
const dryRun = args.includes("--dry-run");

if (!to) {
  console.error("error: --to <tag> is required (e.g. --to v0.5.0)");
  process.exit(2);
}

const gh = (cmd) => execSync(`gh ${cmd}`, { encoding: "utf8" });

function assetUrl(tag) {
  // The updater manifest asset is named latest.json on each release.
  const json = gh(`release view ${tag} --repo ${repo} --json assets`);
  const assets = JSON.parse(json).assets || [];
  const asset = assets.find((a) => a.name === "latest.json");
  if (!asset) throw new Error(`release ${tag} has no latest.json asset`);
  return asset;
}

function main() {
  console.log(`Rollback target: ${to}  (repo ${repo})`);
  // 1. Confirm the target release + its manifest exist.
  assetUrl(to);
  // 2. Download that version's manifest.
  gh(`release download ${to} --repo ${repo} --pattern latest.json --clobber --dir .`);
  const manifest = JSON.parse(execSync("cat latest.json", { encoding: "utf8" }));
  console.log(`Fetched manifest for version ${manifest.version}`);

  if (dryRun) {
    writeFileSync("latest.rollback.json", JSON.stringify(manifest, null, 2));
    console.log(
      "DRY RUN — wrote latest.rollback.json. No release modified.\n" +
        "Re-run without --dry-run to republish it to the 'latest' release.",
    );
    return;
  }

  // 3. Republish it onto whichever release the updater endpoint resolves as
  //    'latest'. We overwrite the latest.json asset on the newest release so
  //    the /releases/latest/download/latest.json URL now advertises `to`.
  const latestTag = JSON.parse(
    gh(`release list --repo ${repo} --limit 1 --json tagName`),
  )[0]?.tagName;
  if (!latestTag) throw new Error("no releases found");
  gh(`release upload ${latestTag} latest.json --repo ${repo} --clobber`);
  console.log(
    `Republished ${to}'s manifest as ${latestTag}/latest.json. ` +
      `Clients will downgrade to ${manifest.version} on next check.`,
  );
}

try {
  main();
} catch (e) {
  console.error("rollback failed:", e.message);
  process.exit(1);
}
