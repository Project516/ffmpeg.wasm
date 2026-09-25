#!/usr/bin/env node
// Reads the FATE .mak files fetched by fetch-defs.mjs, extracts framecrc /
// framemd5 tests from the allowlisted files in config.mjs, and writes a
// manifest of the chosen subset as JSON.
//
// Usage: node scripts/fate/select.mjs --tag n9.0.2 --subset fast --out manifest.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAK_FILES, SUBSETS, cacheDirForTag } from "./config.mjs";
import { classifyTest, parseMakFile, resolveVars } from "./lib/mak.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = { tag: null, subset: "fast", out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") args.tag = argv[++i];
    else if (argv[i] === "--subset") args.subset = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  if (!args.tag || !args.out) {
    throw new Error("usage: select.mjs --tag <ffmpeg-tag> --subset fast|full --out <file.json>");
  }
  if (!SUBSETS[args.subset]) {
    throw new Error(`unknown subset "${args.subset}", expected one of: ${Object.keys(SUBSETS).join(", ")}`);
  }
  return args;
}

function main() {
  const { tag, subset, out } = parseArgs(process.argv.slice(2));
  const { syntheticOnly, maxTests } = SUBSETS[subset];
  const makDir = join(repoRoot, cacheDirForTag(tag), "ffmpeg-src", "tests", "fate");

  // Collect each file's eligible tests first, so a big early file (e.g.
  // filter-audio.mak) can't consume the whole budget before files listed
  // after it in MAK_FILES get a turn.
  let unsupported = 0;
  const perFile = [];
  for (const makFile of MAK_FILES) {
    const path = join(makDir, makFile);
    if (!existsSync(path)) {
      console.warn(`skip ${makFile}: not found in ${tag}'s tests/fate/`);
      continue;
    }
    const parsed = parseMakFile(readFileSync(path, "utf8"));
    const eligible = [];
    for (const test of parsed) {
      const { kind, samples, generate } = classifyTest(test);
      if (kind === "unsupported") {
        unsupported++;
        continue;
      }
      if (syntheticOnly && kind !== "synthetic") continue;
      eligible.push({ test, kind, samples, generate });
    }
    perFile.push({ makFile, eligible, taken: 0 });
  }

  function take(entry) {
    // Args are resolved against this test's own SRC/SRC2/... variables here
    // so run.mjs only has to substitute the two build-wide paths,
    // $(TARGET_PATH) and $(TARGET_SAMPLES).
    const { test, kind, samples, generate } = entry.eligible[entry.taken++];
    const args = resolveVars(test.args, test.vars);
    tests.push({ name: test.name, mode: test.mode, args, kind, samples, generate, makFile: entry.makFile });
  }

  const tests = [];
  // First pass: give every file an even share of the budget.
  const perFileMax = Math.ceil(maxTests / Math.max(perFile.length, 1));
  for (const entry of perFile) {
    while (tests.length < maxTests && entry.taken < perFileMax && entry.taken < entry.eligible.length) take(entry);
  }
  // Second pass: fill whatever budget files with fewer tests left unused.
  for (let more = true; tests.length < maxTests && more; ) {
    more = false;
    for (const entry of perFile) {
      if (tests.length >= maxTests) break;
      if (entry.taken < entry.eligible.length) {
        take(entry);
        more = true;
      }
    }
  }

  const manifest = {
    tag,
    subset,
    generatedAt: new Date().toISOString(),
    counts: {
      selected: tests.length,
      unsupported,
    },
    tests,
  };
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`selected ${tests.length} tests for tag=${tag} subset=${subset} -> ${out}`);
}

main();
