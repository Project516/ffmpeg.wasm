#!/usr/bin/env node
// Rsyncs the sample files a manifest's sample-backed tests need from the
// FATE samples mirror, limited strictly to what those tests reference. Does
// nothing (and needs no network) for a manifest that only has synthetic
// tests, e.g. the "fast" subset used on pull requests.
//
// Usage: node scripts/fate/fetch-samples.mjs --manifest manifest.json --tag n9.0.2
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FATE_SUITE_RSYNC, cacheDirForTag } from "./config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const RSYNC_RETRIES = 3;

// The FATE mirror is a single volunteer-run host; --timeout drops a stalled
// transfer instead of hanging until the runner's own 6h job timeout, and a
// few retries ride out a transient failure without failing the whole job.
function rsyncWithRetry(args) {
  for (let attempt = 1; attempt <= RSYNC_RETRIES; attempt++) {
    try {
      execFileSync("rsync", ["--timeout=60", ...args], { stdio: "inherit" });
      return;
    } catch (err) {
      if (attempt === RSYNC_RETRIES) throw err;
      console.warn(`rsync failed (attempt ${attempt}/${RSYNC_RETRIES}), retrying: ${err.message}`);
    }
  }
}

function parseArgs(argv) {
  const args = { manifest: null, tag: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest") args.manifest = argv[++i];
    else if (argv[i] === "--tag") args.tag = argv[++i];
  }
  if (!args.manifest || !args.tag) {
    throw new Error("usage: fetch-samples.mjs --manifest <file.json> --tag <ffmpeg-tag>");
  }
  return args;
}

function main() {
  const { manifest, tag } = parseArgs(process.argv.slice(2));
  const { tests } = JSON.parse(readFileSync(manifest, "utf8"));

  const relpaths = new Set();
  for (const test of tests) {
    if (test.kind !== "sample") continue;
    for (const sample of test.samples) relpaths.add(sample);
  }

  if (relpaths.size === 0) {
    console.log("no sample-backed tests in this manifest, nothing to fetch");
    return;
  }

  const samplesDir = join(repoRoot, cacheDirForTag(tag), "samples");
  mkdirSync(samplesDir, { recursive: true });

  let fetched = 0;
  for (const relpath of relpaths) {
    const dest = join(samplesDir, relpath);
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    console.log(`+ rsync ${FATE_SUITE_RSYNC}${relpath}`);
    rsyncWithRetry(["-aL", `${FATE_SUITE_RSYNC}${relpath}`, dest]);
    fetched++;
  }
  console.log(`fetched ${fetched} new sample(s) into ${samplesDir} (${relpaths.size} total referenced)`);
}

main();
