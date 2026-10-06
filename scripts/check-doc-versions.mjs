#!/usr/bin/env node
// Checks that apps/website/docs/overview.md's Libraries table has not drifted
// from the versions actually pinned in the Dockerfile, and that
// apps/website/src/data/core-sizes.json is for the current package version. Run with
// `node scripts/check-doc-versions.mjs`.
//
// Each entry maps one or more Dockerfile pins to the row they must appear in,
// in apps/website/docs/overview.md's Libraries table. Most rows pin a single
// value; FFmpeg pins two (the st and mt cores build different FFmpeg
// releases; see "FFmpeg upgrade plan" in AGENTS.md), so both must be present.
// Extend this list whenever the Dockerfile adds, removes, or renames a
// pinned library.
const DOCKERFILE_TO_ROW = [
  { row: "Emscripten", patterns: [/FROM emscripten\/emsdk:([^\s@]+)/] },
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
  { row: "dav1d", patterns: [/ENV DAV1D_BRANCH=(\S+)/] },
];

import { readFileSync, readdirSync } from "node:fs";
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

// The Playground's download sizes must describe the version it loads, and
// that version must be the one the packages are at.
const coreSizes = JSON.parse(
  readFileSync(join(repoRoot, "apps/website/src/data/core-sizes.json"), "utf8")
);
const playgroundConst = readFileSync(
  join(repoRoot, "apps/website/src/components/Playground/const.ts"),
  "utf8"
);
const coreVersion = playgroundConst.match(/CORE_VERSION = "([^"]+)"/)?.[1];
if (!coreVersion) {
  errors.push('Playground const.ts has no CORE_VERSION = "<version>" line');
} else if (coreSizes.version !== coreVersion) {
  errors.push(
    `core-sizes.json is for ${coreSizes.version} but Playground CORE_VERSION is ${coreVersion}; run node scripts/update-core-sizes.mjs ${coreVersion}`
  );
}
for (const dir of readdirSync(join(repoRoot, "packages"))) {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "packages", dir, "package.json"), "utf8")
  );
  if (pkg.version !== coreSizes.version) {
    errors.push(
      `packages/${dir} is ${pkg.version} but core-sizes.json is for ${coreSizes.version}; run node scripts/update-core-sizes.mjs ${pkg.version}`
    );
  }
}

if (errors.length > 0) {
  console.error("Docs are out of date:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("overview.md Libraries table matches the Dockerfile, and core-sizes.json matches the package version.");
