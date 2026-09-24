# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.13.1

### Breaking changes

- Every package is renamed with an `ffmpeg-wasm` prefix:

  | 0.13.0 | 0.13.1 |
  | --- | --- |
  | `@project516/ffmpeg` | `@project516/ffmpeg-wasm` |
  | `@project516/util` | `@project516/ffmpeg-wasm-util` |
  | `@project516/core` | `@project516/ffmpeg-wasm-core` |
  | `@project516/core-mt` | `@project516/ffmpeg-wasm-core-mt` |
  | `@project516/types` | `@project516/ffmpeg-wasm-types` |

  The 0.13.0 packages under the old names are unpublished. The default core
  URL now points at `@project516/ffmpeg-wasm-core` on jsDelivr. The code is
  otherwise the same as 0.13.0.

## 0.13.0

First release of the fork under the `@project516` npm scope.

### Breaking changes

- Packages move from `@ffmpeg/*` to `@project516/*`: `@project516/ffmpeg`,
  `@project516/util`, `@project516/core`, `@project516/core-mt`, and
  `@project516/types`.
- The default core URL in `@project516/ffmpeg` now points at
  `@project516/core` on jsDelivr instead of `@ffmpeg/core`.
- `@project516/core-mt` no longer ships `ffmpeg-core.worker.js` and drops its
  `./worker` export. Current Emscripten builds the pthread worker into
  `ffmpeg-core.js` instead of emitting it separately.
- `load()`'s `workerURL` option is deprecated: it is still accepted so
  existing calls do not break, but it has no effect.

### Fixed

- A worker that fails to load or crashes now rejects every pending call
  instead of hanging, and is terminated so a later `load()` can recover.
- When the core fails to load, the error names both the `importScripts()`
  and the `import()` failure instead of a generic message.
- Abort listeners are removed once a message settles, instead of
  accumulating.
- The UMD build starts a classic worker and the ESM build a module worker,
  so each build loads the core the way its worker type supports.
- `exec()` and `ffprobe()` now free their argv allocation and restore the
  wasm stack pointer in a `finally` block, fixing a memory leak across
  repeated calls.
- The core-mt build's wasm memory can now grow up to 2 GB instead of a fixed,
  non-growable 1 GB, so a single high-resolution frame no longer runs out of
  memory.
- Compressed downloads report an unknown total instead of throwing
  `ERROR_INCOMPLETED_DOWNLOAD`, since `Content-Length` reflects the
  compressed size while the body is decompressed on the fly.
- `@project516/util`'s UMD bundle is now built from the ESM output, fixing
  stray `require()` calls that broke the bundle.
- A dead base64 branch in `fetchFile` that never matched a real data URL is
  removed; `fetch()` already handles `data:` URLs.

### Changed

- Repo tooling moves to a pnpm workspace with its own CI and Dependabot
  setup.

### Build

- emsdk 3.1.40 to 6.0.10.
- FFmpeg n5.1.4 to n5.1.10.
- Third-party library versions: x265 4.2, libvpx 1.17.0, opus 1.6.1, vorbis
  1.3.7, zlib 1.3.2, libwebp 1.6.0, freetype 2.14.3, fribidi 1.0.17, harfbuzz
  8.5.0, libass 0.17.5, zimg 3.0.6, ogg 1.3.6. x264 and lame stay pinned to
  their existing mirrors; see PR #5 for why.

### Credits

Several fixes in this release port work from upstream `ffmpegwasm/ffmpeg.wasm`
contributors: Ben Younes, Daniel Barta, Mrmaxmeier, and 落日归山海.
