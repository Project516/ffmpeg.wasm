// Which FATE test files to draw the compatibility subset from, and how big
// each subset is. Grow these lists over time; keep them here so fetch.mjs,
// select.mjs and run.mjs agree on what "fast" and "full" mean.
//
// The idea of measuring ffmpeg.wasm against FFmpeg's own FATE suite comes
// from wasmpeg's COMPAT.md and CORRECTNESS.md
// (https://github.com/wasmpeg/wasmpeg, LGPL-2.1-or-later).

// .mak files under FFmpeg's tests/fate/ that define framecrc/framemd5 tests
// for common demuxers, decoders and filters. Extend this list to grow the
// subset; each addition only needs the .mak file to exist in the pinned
// FFmpeg tag's tests/fate/ directory.
export const MAK_FILES = [
  "filter-audio.mak",
  "filter-video.mak",
  "vorbis.mak",
  "mp3.mak",
  "flac.mak",
  "vp8.mak",
  "vp9.mak",
  "h264.mak",
  "mov.mak",
  "matroska.mak",
  "demux.mak",
];

export const SUBSETS = {
  // Runs on every pull request: synthetic tests only (lavfi sources etc.),
  // so it needs no sample download and stays fast and network-free.
  fast: {
    syntheticOnly: true,
    maxTests: 25,
  },
  // Runs nightly and on workflow_dispatch: adds sample-backed tests, fetched
  // over rsync from the FATE samples mirror.
  full: {
    syntheticOnly: false,
    maxTests: 200,
  },
};

export const FATE_SUITE_RSYNC = "rsync://fate-suite.ffmpeg.org/fate-suite/";

export function cacheDirForTag(tag) {
  return `.fate-cache/${tag}`;
}
