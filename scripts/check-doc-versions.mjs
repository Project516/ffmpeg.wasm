#!/usr/bin/env node
// Checks that apps/website/docs/overview.md's Libraries table has not drifted
// from the versions actually pinned in the Dockerfile. Run with
// `node scripts/check-doc-versions.mjs`.
//
// Each entry maps one or more Dockerfile pins to the row they must appear in,
// in apps/website/docs/overview.md's Libraries table. Most rows pin a single
// value; FFmpeg pins two (the st and mt cores build different FFmpeg
// releases; see "FFmpeg upgrade plan" in AGENTS.md), so both must be present.
// Extend this list whenever the Dockerfile adds, removes, or renames a
// pinned library.
const DOCKERFILE_TO_ROW = [
  { row: "Emscripten", patterns: [/FROM emscripten\/emsdk:(\S+)/] },
  {
    row: "FFmpeg",
    patterns: [/ENV FFMPEG_VERSION_MT=(\S+)/, /ENV FFMPEG_VERSION_ST=(\S+)/],
  },
  { row: "x264", patterns: [/ENV X264_BRANCH=(\S+)/] },
  { row: "x265", patterns: [/ENV X265_BRANCH=(\S+)/] },
  { row: "libvpx", patterns: [/ENV LIBVPX_BRANCH=(\S+)/] },
  { row: "lame", patterns: [/ENV LAME_BRANCH=(\S+)/] },
  { row: "ogg", patterns: [/ENV OGG_BRANCH=(\S+)/] },
  { row: "theora", patterns: [/ENV THEORA_BRANCH=(\S+)/] },
  { row: "opus", patterns: [/ENV OPUS_BRANCH=(\S+)/] },
  { row: "vorbis", patterns: [/ENV VORBIS_BRANCH=(\S+)/] },
  { row: "zlib", patterns: [/ENV ZLIB_BRANCH=(\S+)/] },
  { row: "libwebp", patterns: [/ENV LIBWEBP_BRANCH=(\S+)/] },
  { row: "freetype2", patterns: [/ENV FREETYPE2_BRANCH=(\S+)/] },
  { row: "fribidi", patterns: [/ENV FRIBIDI_BRANCH=(\S+)/] },
  { row: "harfbuzz", patterns: [/ENV HARFBUZZ_BRANCH=(\S+)/] },
  { row: "libass", patterns: [/ENV LIBASS_BRANCH=(\S+)/] },
  { row: "zimg", patterns: [/ENV ZIMG_BRANCH=(\S+)/] },
];

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfilePath = join(repoRoot, "Dockerfile");
const overviewPath = join(repoRoot, "apps/website/docs/overview.md");

const dockerfile = readFileSync(dockerfilePath, "utf8");
const overview = readFileSync(overviewPath, "utf8");

const errors = [];

for (const { row, patterns } of DOCKERFILE_TO_ROW) {
  const rowLine = overview
    .split("\n")
    .find((line) => line.includes(`name: "${row}"`));
  if (!rowLine) {
    errors.push(`overview.md: no Libraries table row for "${row}"`);
    continue;
  }

  for (const pattern of patterns) {
    const match = dockerfile.match(pattern);
    if (!match) {
      errors.push(`Dockerfile: could not find a pin for "${row}" (pattern ${pattern})`);
      continue;
    }
    const pinnedValue = match[1];

    if (!rowLine.includes(pinnedValue)) {
      errors.push(
        `overview.md: "${row}" row does not mention "${pinnedValue}" (Dockerfile pin)\n  row: ${rowLine.trim()}`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Docs Libraries table is out of date with the Dockerfile:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("overview.md Libraries table matches the Dockerfile.");
