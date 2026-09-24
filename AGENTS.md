# ffmpeg.wasm

FFmpeg compiled to WebAssembly, plus a small TypeScript wrapper
(`@ffmpeg/ffmpeg`, `@ffmpeg/util`) for running FFmpeg in browsers. A
maintained fork of the abandoned `ffmpegwasm/ffmpeg.wasm`.

## Direction

- Stay close to upstream FFmpeg releases; do not fork behavior unnecessarily.
- Small bundle size and low memory use over feature breadth.
- The single-thread core must keep working without `SharedArrayBuffer`.
- No breaking API changes without a major version bump.
- Simple code over clever code.

## Layout

- `packages/core`, `packages/core-mt`: built wasm artifacts (single-thread,
  multi-thread). Not source, produced by the Docker build.
- `packages/ffmpeg`: the worker-based API that loads a core and runs it.
- `packages/util`: browser helper functions (fetchFile, etc).
- `packages/types`: shared TypeScript types.
- `src/fftools`: vendored, patched FFmpeg CLI sources.
- `src/bind`: JS glue passed to emcc when building the core.
- `build/`: per-library build scripts used by the Dockerfile.
- `apps/`: standalone examples, not part of the pnpm workspace.
- `tests/`: browser tests run against built cores.

## Commands

- `pnpm install`
- `pnpm build`
- `pnpm lint`
- Core builds need Docker and are CI-only on low-memory dev machines: `make
  prd` (single-thread), `make prd-mt` (multi-thread).

## Glossary

- **core**: the emscripten-built `ffmpeg-core.js` / `ffmpeg-core.wasm`.
- **st / mt**: single-thread vs multithread core.
- **fftools**: FFmpeg's own CLI sources, vendored under `src/fftools`.
- **bind**: the pre-js glue in `src/bind` linked into the core build.

## Review

PRs target `master` and squash merge. A review bot must review the head
commit before merge.
