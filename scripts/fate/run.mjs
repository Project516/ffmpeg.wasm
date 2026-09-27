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
// core.exec() is synchronous, and the wasm side's own timeout check
// (core.setTimeout(), src/fftools/ffmpeg.c's is_timeout()) is only polled
// inside transcode()'s main loop. A hang before that loop, or stuck inside
// one decode/filter call, never reaches that check, so it alone cannot stop
// a hung test. Each test therefore runs in its own child process (`--index`,
// below), which the parent kills, process group included, if it outlives
// CHILD_TIMEOUT_MS; see scripts/bench/run.mjs for the same pattern.
//
// Usage: node scripts/fate/run.mjs --core packages/core --manifest manifest.json --out results.json
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDirForTag } from "./config.mjs";
import { tokenize } from "./lib/argv.mjs";
import { compareOutput } from "./lib/compare.mjs";
import { generateInputs } from "./lib/gen.mjs";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = join(scriptPath, "..", "..", "..");
const SAMPLES_MOUNT = "/fate-samples";
// Where $(TARGET_PATH) in a test's args resolves to inside MEMFS: the root
// generated inputs (tests/data/asynth-*.wav, ...) are written under, mirroring
// their path relative to FFmpeg's own build tree.
const BUILD_ROOT = "/fate-build";
// core.setTimeout(ms) makes the wasm side's own is_timeout() check call
// exit_program(1) once transcode() has run this long; see
// src/fftools/ffmpeg.c and build/patches/n9/fftools-wasm.patch. That exit
// code (1) is indistinguishable from an ordinary ffmpeg failure, so runExec
// also checks wall time to tell a real timeout apart from a fast failure.
const EXEC_TIMEOUT_MS = 60_000;
// The external per-test watchdog: longer than EXEC_TIMEOUT_MS to leave room
// for node/core startup and teardown around the exec() call it is meant to
// backstop, not to race it.
const CHILD_TIMEOUT_MS = EXEC_TIMEOUT_MS + 20_000;

function parseArgs(argv) {
  const args = { core: null, manifest: null, out: null, index: null, result: null, generatedDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--core") args.core = argv[++i];
    else if (argv[i] === "--manifest") args.manifest = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--index") args.index = Number(argv[++i]);
    else if (argv[i] === "--result") args.result = argv[++i];
    else if (argv[i] === "--generated-dir") args.generatedDir = argv[++i];
  }
  if (args.index != null) {
    if (!args.core || !args.manifest || !args.result || !args.generatedDir) {
      throw new Error("usage: run.mjs --one-test-child --core <path> --manifest <file> --index <n> --result <file> --generated-dir <dir>");
    }
    return args;
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

function writeHostFile(FS, mountRoot, dir, relpath) {
  const dest = `${mountRoot}/${relpath}`;
  mkdirp(FS, dirname(dest));
  FS.writeFile(dest, readFileSync(join(dir, relpath)));
}

// Sync checks that decide whether a test can run at all: no core needed, so
// the parent does these itself before spending a child process on a test
// that can only ever end in "skip".
function preflight(test, refDir, samplesDir, generatedDir) {
  if (test.kind === "sample") {
    for (const relpath of test.samples) {
      if (!existsSync(join(samplesDir, relpath))) return { status: "skip", reason: `sample not fetched: ${relpath}` };
    }
  }
  for (const spec of test.generate ?? []) {
    if (!existsSync(join(generatedDir, spec.path))) return { status: "skip", reason: `${spec.path} not generated` };
  }
  if (!existsSync(join(refDir, test.name))) return { status: "skip", reason: "no reference file" };
  return null;
}

// Runs inside the per-test child process: creates a fresh core, writes this
// test's inputs into its MEMFS, execs it, and compares the output. Anything
// this throws, or a hang the parent's watchdog has to kill, is turned into a
// "fail" result by the caller.
async function runExec(createFFmpegCore, test, refDir, samplesDir, generatedDir) {
  const core = await createFFmpegCore();
  const logLines = [];
  core.setLogger(({ message }) => logLines.push(message));
  core.setProgress(() => {});
  core.setTimeout(EXEC_TIMEOUT_MS);

  if (test.kind === "sample") {
    for (const relpath of test.samples) writeHostFile(core.FS, SAMPLES_MOUNT, samplesDir, relpath);
  }
  for (const spec of test.generate ?? []) writeHostFile(core.FS, BUILD_ROOT, generatedDir, spec.path);

  const args = test.args.replaceAll("$(TARGET_SAMPLES)", SAMPLES_MOUNT).replaceAll("$(TARGET_PATH)", BUILD_ROOT);
  const outPath = "/fate-out";
  const argv = [...tokenize(args), "-f", test.mode === "framecrc" ? "framecrc" : "framemd5", "-y", outPath];

  let ret;
  const execStart = Date.now();
  try {
    ret = core.exec(...argv);
  } catch (err) {
    return { status: "fail", reason: `exec threw: ${err.message}`, log: logLines.slice(-20) };
  }
  if (ret !== 0) {
    if (Date.now() - execStart >= EXEC_TIMEOUT_MS) {
      return { status: "fail", reason: "timeout" };
    }
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

  const refPath = join(refDir, test.name);
  const expected = readFileSync(refPath, "utf8");
  const { ok, diff } = compareOutput(actual, expected);
  return ok ? { status: "pass" } : { status: "fail", reason: "checksum mismatch", diff };
}

// Child-process entry point: run exactly one test and write its result as
// JSON, so the parent doesn't have to disentangle it from anything the core
// or ffmpeg might print.
async function runChild(args) {
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const test = manifest.tests[args.index];
  const createFFmpegCore = require(resolve(args.core));
  const ffmpegSrcTests = join(repoRoot, cacheDirForTag(manifest.tag), "ffmpeg-src", "tests");
  const refDir = join(ffmpegSrcTests, "ref", "fate");
  const samplesDir = join(repoRoot, cacheDirForTag(manifest.tag), "samples");

  const result = await runExec(createFFmpegCore, test, refDir, samplesDir, args.generatedDir);
  writeFileSync(args.result, JSON.stringify(result));
  process.exit(0);
}

// Spawns this same script as `--index <n>` under a watchdog: detached, in
// its own process group, SIGKILLed whole (not just the immediate node
// process) if it outlives CHILD_TIMEOUT_MS. See scripts/bench/run.mjs's
// runUnderTime for the same shape.
function runIndexWithWatchdog({ corePkg, manifestPath, index, generatedDir }) {
  return new Promise((resolvePromise) => {
    const resultPath = join(tmpdir(), `fate-result-${process.pid}-${index}-${Math.random().toString(36).slice(2)}.json`);
    const child = spawn(
      process.execPath,
      [scriptPath, "--core", corePkg, "--manifest", manifestPath, "--index", String(index), "--result", resultPath, "--generated-dir", generatedDir],
      { stdio: "inherit", detached: true },
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, CHILD_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ status: "fail", reason: `child process error: ${err.message}` });
    });
    child.on("exit", () => {
      clearTimeout(timer);
      if (timedOut) {
        rmSync(resultPath, { force: true });
        resolvePromise({ status: "fail", reason: "timeout" });
        return;
      }
      try {
        const result = JSON.parse(readFileSync(resultPath, "utf8"));
        resolvePromise(result);
      } catch (err) {
        resolvePromise({ status: "fail", reason: `child produced no result: ${err.message}` });
      } finally {
        rmSync(resultPath, { force: true });
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.index != null) {
    await runChild(args);
    return;
  }

  const { core: corePkg, manifest: manifestPath, out } = args;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

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

  // Generated once, on the host filesystem, so every per-test child process
  // can read the same files rather than each recompiling audiogen/videogen.
  const generatedDir = mkdtempSync(join(tmpdir(), "fate-generated-"));
  if (generateSpecs.length > 0) {
    try {
      for (const [path, data] of generateInputs(ffmpegSrcTests, generateSpecs)) {
        const dest = join(generatedDir, path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
      }
    } catch (err) {
      console.warn(`could not generate inputs: ${err.message}`);
    }
  }

  try {
    const results = [];
    for (let i = 0; i < manifest.tests.length; i++) {
      const test = manifest.tests[i];
      const skip = preflight(test, refDir, samplesDir, generatedDir);
      const result = skip ?? (await runIndexWithWatchdog({ corePkg, manifestPath, index: i, generatedDir }));
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
  } finally {
    rmSync(generatedDir, { recursive: true, force: true });
  }
}

main();
