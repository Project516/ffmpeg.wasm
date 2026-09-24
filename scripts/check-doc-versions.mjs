#!/usr/bin/env node
// Checks that apps/website/docs/overview.md's Libraries table has not drifted
// from the versions actually pinned in the Dockerfile. Run with
// `node scripts/check-doc-versions.mjs`.
//
// Each entry maps a Dockerfile pin to the row it must appear in, in
// apps/website/docs/overview.md's Libraries table. Extend this list whenever
// the Dockerfile adds, removes, or renames a pinned library.
const DOCKERFILE_TO_ROW = [
  { row: "Emscripten", pattern: /FROM emscripten\/emsdk:(\S+)/ },
  { row: "FFmpeg", pattern: /ENV FFMPEG_VERSION=(\S+)/ },
  { row: "x264", pattern: /ENV X264_BRANCH=(\S+)/ },
  { row: "x265", pattern: /ENV X265_BRANCH=(\S+)/ },
  { row: "libvpx", pattern: /ENV LIBVPX_BRANCH=(\S+)/ },
  { row: "lame", pattern: /ENV LAME_BRANCH=(\S+)/ },
  { row: "ogg", pattern: /ENV OGG_BRANCH=(\S+)/ },
  { row: "theora", pattern: /ENV THEORA_BRANCH=(\S+)/ },
  { row: "opus", pattern: /ENV OPUS_BRANCH=(\S+)/ },
  { row: "vorbis", pattern: /ENV VORBIS_BRANCH=(\S+)/ },
  { row: "zlib", pattern: /ENV ZLIB_BRANCH=(\S+)/ },
  { row: "libwebp", pattern: /ENV LIBWEBP_BRANCH=(\S+)/ },
  { row: "freetype2", pattern: /ENV FREETYPE2_BRANCH=(\S+)/ },
  { row: "fribidi", pattern: /ENV FRIBIDI_BRANCH=(\S+)/ },
  { row: "harfbuzz", pattern: /ENV HARFBUZZ_BRANCH=(\S+)/ },
  { row: "libass", pattern: /ENV LIBASS_BRANCH=(\S+)/ },
  { row: "zimg", pattern: /ENV ZIMG_BRANCH=(\S+)/ },
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

for (const { row, pattern } of DOCKERFILE_TO_ROW) {
  const match = dockerfile.match(pattern);
  if (!match) {
    errors.push(`Dockerfile: could not find a pin for "${row}" (pattern ${pattern})`);
    continue;
  }
  const pinnedValue = match[1];

  const rowLine = overview
    .split("\n")
    .find((line) => line.includes(`name: "${row}"`));
  if (!rowLine) {
    errors.push(`overview.md: no Libraries table row for "${row}"`);
    continue;
  }
  if (!rowLine.includes(pinnedValue)) {
    errors.push(
      `overview.md: "${row}" row does not mention "${pinnedValue}" (Dockerfile pin)\n  row: ${rowLine.trim()}`
    );
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
