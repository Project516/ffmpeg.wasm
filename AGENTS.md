# ffmpeg.wasm

FFmpeg compiled to WebAssembly, plus a small TypeScript wrapper
(`@project516/ffmpeg`, `@project516/util`) for running FFmpeg in browsers. A
maintained fork of the abandoned `ffmpegwasm/ffmpeg.wasm`.

## Direction

- Stay close to upstream FFmpeg releases; do not fork behavior unnecessarily.
- Small bundle size and low memory use over feature breadth.
- The single-thread core must keep working without `SharedArrayBuffer`.
- No breaking API changes without a major version bump.
- Simple code over clever code.

## FFmpeg upgrade plan

The cores stay on FFmpeg 5.1.x for now. Since 6.0 the ffmpeg CLI in fftools
runs a threaded scheduler and needs real pthreads, which the st core does not
have. The plan:

1. Move the build toolchain (emsdk and libraries) to current releases on 5.1.x.
2. Port the fftools patches to the current FFmpeg release for the mt core.
3. Give the st core a cooperative pthread shim on Emscripten fibers so the
   same fftools run without `SharedArrayBuffer`.

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

PRs target `master` and squash merge. The CI jobs `js`, `build-core`,
`build-core-mt`, and `tests` are required checks.

Review happens before merge, on the head commit:

- project516-review-bot reviews every push. Reply on its inline threads with
  evidence; it concedes or pushes back in the thread, and it lifts its own
  CHANGES_REQUESTED once every thread is settled. Its CHANGES_REQUESTED blocks
  merging.
- If review-bot fails to review a head (its free models time out or return
  nothing) or keeps making claims that are verifiably false, a Sonnet subagent
  reviews the PR instead, and its findings are fixed or answered on the PR.
- CodeRabbit is on the free tier and is usually rate limited. When it does
  request changes, that also blocks: resolve its threads once fixed and ask it
  to approve.
- Do not arm auto-merge; merge once CI is green and the review is settled.
