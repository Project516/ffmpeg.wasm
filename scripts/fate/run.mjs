#!/usr/bin/env node
// Runs a FATE manifest (from select.mjs) against one built core, comparing
// framecrc/framemd5 output with FFmpeg's own reference files, and writes a
// pass/fail/skip report as JSON.
//
// This is a lightweight reimplementation of FFmpeg's tests/fate-run.sh
// framecrc/framemd5 conventions, not a port of that script: it appends
// `-f framecrc`/`-f framemd5` to the test's ffmpeg args, writes the result
// to a file inside the core's virtual filesystem, and diffs it against
// tests/ref/fate/<name>. See scripts/fate/config.mjs for the wasmpeg
// credit and background.
//
// Usage: node scripts/fate/run.mjs --core packages/core --manifest manifest.json --out results.json
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDirForTag } from "./config.mjs";
import { tokenize } from "./lib/argv.mjs";
import { compareOutput } from "./lib/compare.mjs";
import { generateInputs } from "./lib/gen.mjs";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SAMPLES_MOUNT = "/fate-samples";
// Where $(TARGET_PATH) in a test's args resolves to inside MEMFS: the root
// generated inputs (tests/data/asynth-*.wav, ...) are written under, mirroring
// their path relative to FFmpeg's own build tree.
const BUILD_ROOT = "/fate-build";

function parseArgs(argv) {
  const args = { core: null, manifest: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--core") args.core = argv[++i];
    else if (argv[i] === "--manifest") args.manifest = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  if (!args.core || !args.manifest || !args.out) {
    throw new Error("usage: run.mjs --core <path-to-core-package> --manifest <file.json> --out <results.json>");
  }
  return args;
}

function mkdirp(FS, path) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      FS.mkdir(current);
    } catch {
      // already exists
    }
  }
}

function writeSample(FS, samplesDir, relpath) {
  const dest = `${SAMPLES_MOUNT}/${relpath}`;
  mkdirp(FS, dirname(dest));
  const data = readFileSync(join(samplesDir, relpath));
  FS.writeFile(dest, data);
}

function writeGenerated(FS, buildPath, data) {
  const dest = `${BUILD_ROOT}/${buildPath}`;
  mkdirp(FS, dirname(dest));
  FS.writeFile(dest, data);
}

async function runOne(core, test, refDir, samplesDir, generated, generationError) {
  if (test.kind === "sample") {
    for (const relpath of test.samples) {
      const src = join(samplesDir, relpath);
      if (!existsSync(src)) {
        return { status: "skip", reason: `sample not fetched: ${relpath}` };
      }
    }
  }

  for (const spec of test.generate ?? []) {
    if (!generated.has(spec.path)) {
      const reason = generationError ? `could not generate ${spec.path}: ${generationError}` : `${spec.path} not generated`;
      return { status: "skip", reason };
    }
  }

  const refPath = join(refDir, test.name);
  if (!existsSync(refPath)) {
    return { status: "skip", reason: "no reference file" };
  }

  core.reset();
  const logLines = [];
  core.setLogger(({ message }) => logLines.push(message));
  core.setProgress(() => {});

  if (test.kind === "sample") {
    for (const relpath of test.samples) {
      writeSample(core.FS, samplesDir, relpath);
    }
  }
  for (const spec of test.generate ?? []) {
    writeGenerated(core.FS, spec.path, generated.get(spec.path));
  }

  const args = test.args.replaceAll("$(TARGET_SAMPLES)", SAMPLES_MOUNT).replaceAll("$(TARGET_PATH)", BUILD_ROOT);
  const outPath = "/fate-out";
  const argv = [...tokenize(args), "-f", test.mode === "framecrc" ? "framecrc" : "framemd5", "-y", outPath];

  let ret;
  try {
    ret = core.exec(...argv);
  } catch (err) {
    return { status: "fail", reason: `exec threw: ${err.message}`, log: logLines.slice(-20) };
  }
  if (ret !== 0) {
    return { status: "fail", reason: `ffmpeg exited ${ret}`, log: logLines.slice(-20) };
  }

  let actual;
  try {
    actual = Buffer.from(core.FS.readFile(outPath)).toString("utf8");
  } catch (err) {
    return { status: "fail", reason: `no output written: ${err.message}`, log: logLines.slice(-20) };
  } finally {
    try {
      core.FS.unlink(outPath);
    } catch {
      // nothing to clean up
    }
  }

  const expected = readFileSync(refPath, "utf8");
  const { ok, diff } = compareOutput(actual, expected);
  return ok ? { status: "pass" } : { status: "fail", reason: "checksum mismatch", diff };
}

async function main() {
  const { core: corePkg, manifest: manifestPath, out } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const createFFmpegCore = require(resolve(corePkg));

  const ffmpegSrcTests = join(repoRoot, cacheDirForTag(manifest.tag), "ffmpeg-src", "tests");
  const refDir = join(ffmpegSrcTests, "ref", "fate");
  const samplesDir = join(repoRoot, cacheDirForTag(manifest.tag), "samples");

  const generateSpecs = [];
  const seenGeneratePaths = new Set();
  for (const test of manifest.tests) {
    for (const spec of test.generate ?? []) {
      if (seenGeneratePaths.has(spec.path)) continue;
      seenGeneratePaths.add(spec.path);
      generateSpecs.push(spec);
    }
  }

  let generated = new Map();
  let generationError = null;
  if (generateSpecs.length > 0) {
    try {
      generated = generateInputs(ffmpegSrcTests, generateSpecs);
    } catch (err) {
      generationError = err.message;
    }
  }

  const core = await createFFmpegCore();
  const results = [];
  for (const test of manifest.tests) {
    const result = await runOne(core, test, refDir, samplesDir, generated, generationError);
    results.push({ name: test.name, mode: test.mode, makFile: test.makFile, ...result });
    console.log(`${result.status.padEnd(4)} fate-${test.name}${result.reason ? `: ${result.reason}` : ""}`);
  }

  const summary = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) summary[r.status]++;

  const report = {
    tag: manifest.tag,
    subset: manifest.subset,
    core: corePkg,
    generatedAt: new Date().toISOString(),
    summary: { ...summary, total: results.length },
    tests: results,
  };
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`${summary.pass} pass, ${summary.fail} fail, ${summary.skip} skip -> ${out}`);

  if (summary.fail > 0) process.exitCode = 1;
}

main();
