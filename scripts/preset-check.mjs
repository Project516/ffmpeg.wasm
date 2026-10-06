#!/usr/bin/env node
// Prints the size of a built core as a markdown row, then checks that it
// contains the codecs its preset promises and none it leaves out, and that a
// short decode and encode work. Exits 1 on a failed check.
//
// Usage: node scripts/preset-check.mjs --core packages/core --preset web
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const repoRoot = join(import.meta.dirname, "..");

const EXPECT = {
  full: {
    encoders: ["libx264", "libx265", "libvpx-vp9", "libmp3lame", "libopus", "libvorbis", "libwebp", "aac", "png"],
    decoders: ["h264", "hevc", "vp9", "opus", "aac", "mp3", "prores", "libdav1d"],
    av1: true,
    absent: [],
    encodes: [["-c:v", "libx264", "out.mp4"], ["-c:v", "libvpx-vp9", "-b:v", "200k", "out.webm"]],
  },
  web: {
    encoders: ["libx264", "libvpx-vp9", "libmp3lame", "libopus", "libvorbis", "aac", "png"],
    decoders: ["h264", "hevc", "vp9", "opus", "aac", "mp3", "libdav1d"],
    av1: true,
    absent: ["libx265", "prores"],
    encodes: [["-c:v", "libx264", "out.mp4"], ["-c:v", "libvpx-vp9", "-b:v", "200k", "out.webm"]],
  },
  decode: {
    encoders: ["png", "mjpeg"],
    decoders: ["h264", "hevc", "vp9", "opus", "aac", "mp3", "prores", "libdav1d"],
    av1: true,
    absent: ["libx264", "libx265", "libmp3lame", "libvpx-vp9", "libopus"],
    encodes: [],
  },
};

function parseArgs(argv) {
  const args = { core: null, preset: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--core") args.core = argv[++i];
    else if (argv[i] === "--preset") args.preset = argv[++i];
  }
  if (!args.core || !EXPECT[args.preset]) {
    throw new Error(`usage: preset-check.mjs --core <path> --preset ${Object.keys(EXPECT).join("|")}`);
  }
  return args;
}

const mb = (bytes) => (bytes / 1e6).toFixed(2);
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

function sizeRow(corePath, preset) {
  const dir = join(resolve(corePath), "dist", "umd");
  const wasm = readFileSync(join(dir, "ffmpeg-core.wasm"));
  const js = readFileSync(join(dir, "ffmpeg-core.js"));
  const total = gz(wasm) + gz(js);
  return `| ${preset} | ${corePath.endsWith("-mt") ? "mt" : "st"} | ${mb(wasm.length)} | ${mb(gz(wasm))} | ${mb(total)} |`;
}

function names(core, flag) {
  const lines = [];
  core.reset();
  core.setLogger(({ message }) => lines.push(message));
  core.exec("-hide_banner", flag);
  return new Set(
    lines
      .flatMap((l) => l.split("\n"))
      .map((l) => /^\s*[VAS][.\w]{5}\s+(\S+)/.exec(l)?.[1])
      .filter((n) => n && n !== "=")
  );
}

async function main() {
  const { core: corePath, preset } = parseArgs(process.argv.slice(2));
  console.log("| preset | core | wasm (MB) | wasm gzip (MB) | wasm and js gzip (MB) |");
  console.log("| --- | --- | --- | --- | --- |");
  console.log(sizeRow(corePath, preset));

  const expect = EXPECT[preset];
  const core = await require(resolve(corePath))();
  const { VIDEO_1S_MP4 } = require(join(repoRoot, "tests", "test-helper-browser.js"));
  core.FS.writeFile("video.mp4", Buffer.from(VIDEO_1S_MP4, "base64"));

  const problems = [];
  const encoders = names(core, "-encoders");
  const decoders = names(core, "-decoders");
  for (const n of expect.encoders) if (!encoders.has(n)) problems.push(`missing encoder ${n}`);
  for (const n of expect.decoders) if (!decoders.has(n)) problems.push(`missing decoder ${n}`);
  for (const n of expect.absent) if (encoders.has(n) || decoders.has(n)) problems.push(`${n} should not be in this preset`);

  const run = (...args) => {
    core.reset();
    core.setLogger(() => {});
    core.setProgress(() => {});
    return core.exec(...args);
  };
  if (run("-i", "video.mp4", "-f", "null", "-") !== 0) problems.push("decode to null failed");
  if (run("-i", "video.mp4", "-frames:v", "1", "frame.png") !== 0) problems.push("png encode failed");
  if (expect.av1) {
    core.FS.writeFile("av1.webm", readFileSync(join(repoRoot, "tests", "fixtures", "av1.webm")));
    if (run("-i", "av1.webm", "-f", "null", "-") !== 0) problems.push("av1 decode failed");
  }
  for (const args of expect.encodes) {
    if (run("-i", "video.mp4", ...args) !== 0) problems.push(`encode failed: ${args.join(" ")}`);
  }

  for (const p of problems) console.error(`::error::${preset}: ${p}`);
  console.log(problems.length === 0 ? `\n${preset}: checks passed` : `\n${preset}: ${problems.length} check(s) failed`);
  process.exit(problems.length === 0 ? 0 : 1);
}

main();
