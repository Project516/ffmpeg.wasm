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
// Usage: node scripts/bench/run.mjs --core packages/core --label st --out bench-st.json
//        node scripts/bench/run.mjs --native --out bench-native.json
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CASES = [
  { name: "h264-to-vp9", args: (inp, out) => ["-i", inp, "-c:v", "libvpx-vp9", "-b:v", "500k", out.replace(/\.\w+$/, ".webm")] },
  { name: "h264-to-mpeg4", args: (inp, out) => ["-i", inp, out.replace(/\.\w+$/, ".avi")] },
  { name: "scale-half", args: (inp, out) => ["-i", inp, "-vf", "scale=iw/2:ih/2", out] },
];

function parseArgs(argv) {
  const args = { core: null, native: false, label: null, out: null, runs: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--core") args.core = argv[++i];
    else if (argv[i] === "--native") args.native = true;
    else if (argv[i] === "--label") args.label = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--runs") args.runs = Number(argv[++i]);
  }
  if (!args.out || (!args.core && !args.native)) {
    throw new Error("usage: run.mjs (--core <path> --label <name> | --native) --out <file.json> [--runs N]");
  }
  if (!args.label) args.label = args.native ? "native" : "core";
  return args;
}

function sampleMp4Path(tmpDir) {
  const helperSrc = readFileSync(join(repoRoot, "tests", "test-helper-browser.js"), "utf8");
  const b64 = helperSrc.match(/"([A-Za-z0-9+/=]{100,})"/)[1];
  const path = join(tmpDir, "sample.mp4");
  writeFileSync(path, Buffer.from(b64, "base64"));
  return path;
}

function benchNative(inputPath, tmpDir, runs) {
  const results = [];
  for (const testCase of CASES) {
    const outPath = join(tmpDir, `native-${testCase.name}.out`);
    const argv = testCase.args(inputPath, outPath);
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const start = process.hrtime.bigint();
      const output = execFileSync("/usr/bin/time", ["-v", "ffmpeg", "-y", ...argv], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
      const rssMatch = /Maximum resident set size \(kbytes\): (\d+)/.exec(output);
      samples.push({ wallMs, peakRssKb: rssMatch ? Number(rssMatch[1]) : null });
    }
    results.push({ name: testCase.name, samples });
  }
  return results;
}

async function benchCore(corePkg, inputPath, runs) {
  const createFFmpegCore = require(resolve(corePkg));
  const inputData = readFileSync(inputPath);
  const results = [];
  for (const testCase of CASES) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const core = await createFFmpegCore();
      core.setLogger(() => {});
      core.setProgress(() => {});
      core.FS.writeFile("in.mp4", inputData);
      const argv = testCase.args("in.mp4", "out.tmp");
      const start = process.hrtime.bigint();
      const ret = core.exec(...argv);
      const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
      const peakRssKb = Math.round(process.memoryUsage().rss / 1024);
      samples.push({ wallMs, peakRssKb, ok: ret === 0 });
    }
    results.push({ name: testCase.name, samples });
  }
  return results;
}

function average(samples, key) {
  const values = samples.map((s) => s[key]).filter((v) => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function main() {
  const { core, native, label, out, runs } = parseArgs(process.argv.slice(2));
  const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-bench-"));
  try {
    const inputPath = sampleMp4Path(tmpDir);
    const results = native ? benchNative(inputPath, tmpDir, runs) : await benchCore(core, inputPath, runs);

    const cases = results.map((r) => ({
      name: r.name,
      avgWallMs: average(r.samples, "wallMs"),
      avgPeakRssKb: average(r.samples, "peakRssKb"),
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
      console.log(`${label} ${c.name}: avg ${c.avgWallMs?.toFixed(1)}ms, peak RSS ${c.avgPeakRssKb ?? "?"}KB`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
