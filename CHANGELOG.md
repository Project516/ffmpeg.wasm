# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- `open()`, `read()`, `write()` and `close()` read and write a file in chunks
  through a file descriptor (backport of upstream ffmpegwasm/ffmpeg.wasm#984).
  `write()` transfers its `Uint8Array` unless `{ transfer: false }`.

### Changed

- Both cores can grow their wasm memory up to 4 GB, up from 2 GB for the
  multi-thread core and the Emscripten default for the single-thread core.
- The multi-thread core caps the core count FFmpeg sees at 4, uses a 2 MB
  default thread stack, and fails a command that needs more threads than the
  pool has instead of hanging.
- FFmpeg is built with `--disable-network`, SDL is no longer linked, and the
  single-thread core drops the stack overflow check.
- LAME is built with `NDEBUG`, so a failed assert no longer aborts the module.
- x264's `slicetype_slice_cost` has the signature its thread pool calls it
  with.

### Fixed

- When the core traps or aborts during a call, that call rejects with the
  error, pending calls reject, and the `FFmpeg` instance is unloaded
  (`loaded` is `false`) instead of running more commands on a broken core.
  Call `load()` to start a new one (backport of upstream
  ffmpegwasm/ffmpeg.wasm#979).
- The core's `setTimeout()` no longer replaces the global `setTimeout` inside
  the core, which Emscripten's own timers (`poll()` and async callbacks) use.
- The core reads the `wasmURL` hash only when locating the `.wasm` file, and
  loads when `mainScriptUrlOrBlob` has no hash.
- `-loglevel quiet` and `-report` in one `exec()` no longer silence logging in
  the next one, and `-hide_banner` no longer carries over.
- A later `ffprobe()` no longer inherits `-show_entries` from an earlier one,
  and ffprobe returns an error instead of aborting when it cannot open a
  stream's decoder.
- Progress is reported with `-nostats`, stays within 0 and 1, and is 0 for
  inputs with no known duration until the run ends.

## 0.16.0

### Added

- `writeFile(path, data, { transfer: false })` copies a `Uint8Array` to the
  worker instead of transferring it, so the caller's array is not emptied.
  The default is unchanged.
- Under Node.js, `coreURL` and `wasmURL` accept filesystem paths, including
  Windows paths, as well as `file:` URLs.

### Fixed

- The core ends the argv array it passes to ffmpeg and ffprobe with `NULL`.
  0.15.0 could crash on a command whose last argument is an option without a
  value.
- A second `load()` on a loaded `FFmpeg` no longer creates a second core and
  leaks the first. It keeps the loaded core and resolves `false`.
- `load()` names the `wasmURL` in its error when the response is not a
  WebAssembly file.
- `mount()` returns `false` for names such as `__proto__` or `constructor`
  instead of treating them as filesystems.
- `on()` and `off()` work when the `FFmpeg` instance is wrapped in a Proxy,
  such as Vue's `reactive()`.
- `fetchFile()` reads a `Blob` or `File` in Node.js, where `FileReader` does
  not exist.
- The dynamic core import carries `turbopackIgnore`, so Turbopack leaves it
  to run at load time.

## 0.15.0

### Added

- `@project516/ffmpeg-wasm` has three helpers that wrap `writeFile()`,
  `exec()` and `readFile()`: `probe()` returns ffprobe's format and stream
  JSON, `transcode()` returns the converted file's bytes, and `extractFrames()`
  returns encoded png, jpg or webp frames in order. They take a `File`, `Blob`,
  `URL` or `Uint8Array`, remove every file they wrote, including on failure,
  and reject with ffmpeg's last log lines. The types are in
  `@project516/ffmpeg-wasm-types`.
- Codec presets for building smaller cores yourself: `make prd PRESET=web`
  builds a single-thread core that is 4.87 MB gzipped instead of 13.48 MB, and
  `decode` builds one with every decoder and no encoder libraries. The
  published packages keep the `full` preset, so they are unchanged. See
  `apps/website/docs/presets.md`.
- The FATE allowlist grows from 11 to 37 test files. The full subset is 1059
  tests per core, with 1055 passing and four known skips. The CI
  `baseline-check` job compares each run against a committed baseline of FATE
  results and benchmark ratios and fails on a regression. It is not a required
  check.

### Changed

- The timeout tests pass `-re` so the clip cannot finish before the timeout on
  the single-thread core.

## 0.14.0

### Changed

- Both cores now build FFmpeg 9.0.2 (the single-thread core was on 5.1.10).
  The single-thread core runs FFmpeg's threaded scheduler on a cooperative
  pthread shim built on Emscripten fibers, so it still does not need
  `SharedArrayBuffer`. Remuxing and merging with `-c copy`, audio extraction
  to mp3, m4a and opus, and `ffprobe` JSON output are covered by tests on both
  cores.
- The `FFmpeg` class runs the core in a worker thread under Node.js.
- License: the project is now AGPL-3.0-or-later (previously MIT for the JS
  packages and GPL-2.0-or-later for the cores). See NOTICE at the repository
  root for how this fits with the MIT code inherited from upstream and the
  third-party libraries built into the core packages.

### Added

- FFmpeg's own FATE suite and benchmarks run in CI against both cores.

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
