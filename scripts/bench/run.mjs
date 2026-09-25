#!/usr/bin/env node
// Benchmarks a fixed set of transcodes on native FFmpeg and on a built core,
// on the same machine, and reports wall time, peak RSS, and the wasm/native
// ratio as JSON.
//
// Uses the same 1-second H.264 sample the browser/Node tests already embed
// (tests/test-helper-browser.js) so no extra sample download is needed. That
// sample is video-only, so the fixed set covers a codec transcode (H.264 to
// VP9), a container remux to a different codec (H.264 to MPEG-4/avi), and a
// scale filter, rather than the audio example from the issue.
//
// Each sample (one case, one run) is a fresh `node` child process, spawned
// under `/usr/bin/time -v -o <file>`, whether it runs native ffmpeg or a
// core: that is the only way to get a peak (not current) RSS for the wasm
// side, and it puts native and wasm on the same wall-clock and memory
// measurement, taken by the same external tool instead of two different
// ones (process.hrtime/memoryUsage for the core, /usr/bin/time for native).
//
// Usage: node scripts/bench/run.mjs --core packages/core --label st --out bench-st.json
//        node scripts/bench/run.mjs --native --out bench-native.json
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = join(scriptPath, "..", "..", "..");
// Generous relative to the 1-second sample: a stuck core or ffmpeg should
// never be able to stall the whole benchmark job.
const RUN_TIMEOUT_MS = 60_000;

const CASES = [
  { name: "h264-to-vp9", args: (inp, out) => ["-i", inp, "-c:v", "libvpx-vp9", "-b:v", "500k", out.replace(/\.\w+$/, ".webm")] },
  { name: "h264-to-mpeg4", args: (inp, out) => ["-i", inp, out.replace(/\.\w+$/, ".avi")] },
  {
    name: "scale-half",
    args: (inp, out) => ["-i", inp, "-vf", "scale=trunc(iw/4)*2:trunc(ih/4)*2", out.replace(/\.\w+$/, ".mp4")],
  },
];

function parseArgs(argv) {
  const args = { core: null, native: false, label: null, out: null, runs: 3, one: null, input: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--core") args.core = argv[++i];
    else if (argv[i] === "--native") args.native = true;
    else if (argv[i] === "--label") args.label = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--runs") args.runs = Number(argv[++i]);
    else if (argv[i] === "--one") args.one = argv[++i];
    else if (argv[i] === "--input") args.input = argv[++i];
  }
  if (args.one) {
    if (!args.input || (!args.core && !args.native)) {
      throw new Error("usage: run.mjs --one <case> --input <path> (--core <path> | --native)");
    }
    return args;
  }
  if (!args.out || (!args.core && !args.native)) {
    throw new Error("usage: run.mjs (--core <path> --label <name> | --native) --out <file.json> [--runs N]");
  }
  if (!args.label) args.label = args.native ? "native" : "core";
  return args;
}

// tests/test-helper-browser.js exports VIDEO_1S_MP4 for the browser/Node
// test suite; requiring it directly means one less place assuming its
// base64 payload is the only long quoted string in the file.
function sampleMp4Path(tmpDir) {
  const { VIDEO_1S_MP4 } = require(join(repoRoot, "tests", "test-helper-browser.js"));
  const path = join(tmpDir, "sample.mp4");
  writeFileSync(path, Buffer.from(VIDEO_1S_MP4, "base64"));
  return path;
}

// Runs exactly one (case, native-or-core) sample in this process and exits;
// the parent spawns this under /usr/bin/time -v to measure it from outside.
async function runOne({ one, core, native, input }) {
  const testCase = CASES.find((c) => c.name === one);
  if (!testCase) throw new Error(`unknown case: ${one}`);

  const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-bench-one-"));
  try {
    if (native) {
      execFileSync("ffmpeg", ["-y", ...testCase.args(input, join(tmpDir, "out.tmp"))], { stdio: "ignore" });
    } else {
      const createFFmpegCore = require(resolve(core));
      const ffcore = await createFFmpegCore();
      ffcore.setLogger(() => {});
      ffcore.setProgress(() => {});
      ffcore.FS.writeFile("in.mp4", readFileSync(input));
      const ret = ffcore.exec(...testCase.args("in.mp4", "out.tmp"));
      if (ret !== 0) throw new Error(`ffmpeg exited ${ret}`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function parseElapsed(text) {
  const parts = text.split(":").map(Number);
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return parts[0] * 1000;
}

function parseTimeStats(text) {
  const rssMatch = /Maximum resident set size \(kbytes\): (\d+)/.exec(text);
  const elapsedMatch = /Elapsed \(wall clock\) time.*: ([\d:.]+)/.exec(text);
  return {
    peakRssKb: rssMatch ? Number(rssMatch[1]) : null,
    wallMs: elapsedMatch ? parseElapsed(elapsedMatch[1]) : null,
  };
}

// Spawns `node scriptPath ...childArgs` under `/usr/bin/time -v`, writing
// its stats to a file with `-o` rather than parsing stdout/stderr (`-v`'s
// report goes to stderr, which execFileSync's return value does not carry).
//
// Runs detached, in its own process group, so a RUN_TIMEOUT_MS timer can
// kill the whole group (`kill(-pid)`) rather than just the immediate
// `/usr/bin/time` process: `time` forks the timed `node` process, which for
// the native case execs `ffmpeg` in turn, and a plain SIGTERM to `time`
// alone would leave that descendant running.
function runUnderTime(childArgs) {
  return new Promise((resolvePromise) => {
    const statsPath = join(tmpdir(), `bench-time-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
    const child = spawn("/usr/bin/time", ["-v", "-o", statsPath, process.execPath, scriptPath, ...childArgs], {
      stdio: "inherit",
      detached: true,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, RUN_TIMEOUT_MS);

    const finish = (ok, reason) => {
      clearTimeout(timer);
      let wallMs = null;
      let peakRssKb = null;
      try {
        ({ wallMs, peakRssKb } = parseTimeStats(readFileSync(statsPath, "utf8")));
      } catch {
        // /usr/bin/time itself did not run or write stats; samples stay null.
      } finally {
        rmSync(statsPath, { force: true });
      }
      resolvePromise({ wallMs, peakRssKb, ok, ...(reason ? { reason } : {}) });
    };

    child.on("error", () => finish(false, "spawn error"));
    child.on("exit", (code) => {
      if (timedOut) finish(false, "timeout");
      else finish(code === 0);
    });
  });
}

async function bench({ core, native, inputPath, runs }) {
  const results = [];
  for (const testCase of CASES) {
    const samples = [];
    const childArgs = ["--one", testCase.name, "--input", inputPath, ...(native ? ["--native"] : ["--core", core])];
    for (let i = 0; i < runs; i++) {
      const sample = await runUnderTime(childArgs);
      if (!sample.ok) console.warn(`${testCase.name} run ${i + 1}/${runs} failed${sample.reason ? `: ${sample.reason}` : ""}`);
      samples.push(sample);
    }
    results.push({ name: testCase.name, samples });
  }
  return results;
}

// Only successful runs count: GNU time still writes wall-time/RSS numbers
// for a run that timed out or exited non-zero, so an unfiltered average
// could report a failed transcode as a normal measurement.
function average(samples, key) {
  const values = samples.filter((s) => s.ok).map((s) => s[key]).filter((v) => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.one) {
    await runOne(args);
    return;
  }

  const { core, native, label, out, runs } = args;
  const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-bench-"));
  try {
    const inputPath = sampleMp4Path(tmpDir);
    const results = await bench({ core, native, inputPath, runs });

    const cases = results.map((r) => ({
      name: r.name,
      avgWallMs: average(r.samples, "wallMs"),
      avgPeakRssKb: average(r.samples, "peakRssKb"),
      okRuns: r.samples.filter((s) => s.ok).length,
      totalRuns: r.samples.length,
      samples: r.samples,
    }));

    const report = {
      label,
      native,
      generatedAt: new Date().toISOString(),
      runs,
      cases,
    };
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`wrote ${out}`);
    for (const c of cases) {
      console.log(
        `${label} ${c.name}: avg ${c.avgWallMs?.toFixed(1) ?? "?"}ms, peak RSS ${c.avgPeakRssKb ?? "?"}KB, ${c.okRuns}/${c.totalRuns} runs ok`,
      );
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
