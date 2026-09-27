#!/usr/bin/env node
// Fetches the FATE test definitions and reference files for one FFmpeg tag,
// via a sparse, blobless checkout of just tests/ from the FFmpeg source
// tree. Run once per tag before select.mjs.
//
// Usage: node scripts/fate/fetch-defs.mjs --tag n9.0.2
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDirForTag } from "./config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = { tag: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") args.tag = argv[++i];
  }
  if (!args.tag) {
    throw new Error("usage: fetch-defs.mjs --tag <ffmpeg-tag>");
  }
  return args;
}

function run(cmd, args, cwd) {
  console.log(`+ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function main() {
  const { tag } = parseArgs(process.argv.slice(2));
  const cacheDir = join(repoRoot, cacheDirForTag(tag));
  const srcDir = join(cacheDir, "ffmpeg-src");

  if (existsSync(join(srcDir, "tests", "fate"))) {
    console.log(`found cached FFmpeg tests/ for ${tag} at ${srcDir}`);
    return;
  }

  mkdirSync(cacheDir, { recursive: true });
  run(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      tag,
      "--filter=blob:none",
      "--sparse",
      "https://github.com/FFmpeg/FFmpeg.git",
      srcDir,
    ],
    repoRoot,
  );
  run("git", ["sparse-checkout", "set", "tests"], srcDir);
  console.log(`fetched tests/ for ${tag} into ${srcDir}`);
}

main();
