// Which FATE test files to draw the compatibility subset from, and how big
// each subset is. Grow these lists over time; keep them here so fetch.mjs,
// select.mjs and run.mjs agree on what "fast" and "full" mean.
//
// The idea of measuring ffmpeg.wasm against FFmpeg's own FATE suite comes
// from wasmpeg's COMPAT.md and CORRECTNESS.md
// (https://github.com/wasmpeg/wasmpeg, LGPL-2.1-or-later).

// .mak files under FFmpeg's tests/fate/ that define framecrc, framemd5, crc,
// md5 or md5pipe tests. Extend this list to grow the subset; each addition
// only needs the .mak file to exist in the pinned FFmpeg tag's tests/fate/
// directory. Tests the runner cannot reproduce are left out by select.mjs,
// and tests that are known to fail are listed in KNOWN_FAILURES below.
export const MAK_FILES = [
  // Filters, scaling and resampling.
  "filter-audio.mak",
  "filter-video.mak",
  "ffmpeg.mak",
  "libswscale.mak",
  "libswresample.mak",
  // Containers and demuxers (mp4/mov, matroska/webm, mxf, gif, apng).
  "demux.mak",
  "mov.mak",
  "qt.mak",
  "matroska.mak",
  "mxf.mak",
  "gif.mak",
  "apng.mak",
  // Video decoders.
  "h264.mak",
  "hevc.mak",
  "vpx.mak",
  "vvc.mak",
  "mpeg4.mak",
  "video.mak",
  "image.mak",
  "bmp.mak",
  "prores.mak",
  "dnxhd.mak",
  "utvideo.mak",
  "lossless-video.mak",
  "jpeg2000.mak",
  "hap.mak",
  // Audio decoders.
  "ac3.mak",
  "acodec.mak",
  "opus.mak",
  "audio.mak",
  "adpcm.mak",
  "pcm.mak",
  "voice.mak",
  "microsoft.mak",
  "lossless-audio.mak",
  "wavpack.mak",
  "dca.mak",
];

// Tests that fail on a core for a known reason. They are reported as
// skipped with that reason and never run, so a hang cannot cost the job its
// per-test timeout. Remove an entry once the underlying bug is fixed.
// Keys are test names without the "fate-" prefix; "cores" defaults to all of st, mt and jspi.
//   "h264-conformance-foo": { reason: "why it fails", cores: ["st"] }
export const KNOWN_FAILURES = {
  "matroska-prores-header-insertion-bz2": { reason: "needs bzip2, which the cores are built without" },
  "filter-frei0r-filter": { reason: "frei0r is not built into the cores" },
  "filter-frei0r-filter-unaligned": { reason: "frei0r is not built into the cores" },
  "filter-frei0r-source": { reason: "frei0r is not built into the cores" },
};

export const SUBSETS = {
  // Runs on every pull request: synthetic tests only (lavfi sources etc.),
  // so it needs no sample download and stays fast and network-free.
  fast: {
    syntheticOnly: true,
    maxTests: 40,
  },
  // Runs nightly and on workflow_dispatch: adds sample-backed tests, fetched
  // over rsync from the FATE samples mirror.
  full: {
    syntheticOnly: false,
    maxTests: 2000,
  },
};

export const FATE_SUITE_RSYNC = "rsync://fate-suite.ffmpeg.org/fate-suite/";

export function cacheDirForTag(tag) {
  return `.fate-cache/${tag}`;
}
