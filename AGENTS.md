# ffmpeg.wasm

FFmpeg compiled to WebAssembly, plus a small TypeScript wrapper
(`@project516/ffmpeg-wasm`, `@project516/ffmpeg-wasm-util`) for running FFmpeg in browsers. A
maintained fork of the abandoned `ffmpegwasm/ffmpeg.wasm`.

## Direction

- Stay close to upstream FFmpeg releases; do not fork behavior unnecessarily.
- Small bundle size and low memory use over feature breadth.
- The single-thread core must keep working without `SharedArrayBuffer`.
- No breaking API changes without a major version bump.
- Simple code over clever code.

## FFmpeg upgrade plan

Both cores build FFmpeg n9.0.2. The ffmpeg CLI in fftools has needed a
threaded scheduler since 6.0; the mt core has real pthreads, the st core has
none (no `SharedArrayBuffer`), so it runs the scheduler on a cooperative
pthread shim instead.

1. Move the build toolchain (emsdk and libraries) to current releases. Done.
2. Port the fftools patches to the current FFmpeg release for the mt core.
   Done: `build/patches/n9` patches FFmpeg's own fftools sources at build
   time.
3. Give the st core a cooperative pthread shim on Emscripten fibers so the
   same fftools run without `SharedArrayBuffer`. Done: `src/pthread-fiber`
   implements the pthread subset fftools/libavutil use on top of
   Emscripten fibers, linked in via `-Wl,--wrap`.

Lessons from the shim, so they are not rediscovered:

- Every fiber C stack must be 16-byte aligned. `malloc` only guarantees 8,
  and the compiler relies on the wasm ABI's 16. musl's `__stdio_write` forms
  `iov + 1` as `iov | 8`, which is a no-op on a stack that is 8 mod 16, so it
  passed a zero-length iovec to `fd_write` and looped forever. That was the
  long-standing "st core hangs on video transcodes" bug. It looked like a
  heap-layout Heisenbug because the stack's alignment depends on what the
  heap did before the fiber was created.
- A hang inside native code never returns to JS, so JS cannot sample it from
  the same thread. A worker can attach to the main thread's inspector
  (`inspector.Session.connectToMainThread`), run the CPU profiler, then pause
  and read the paused frame's arguments. Link with `--profiling-funcs` so the
  wasm functions have names. Reading the paused call's arguments found the
  bug above in one CI run after weeks of marker-based guessing.
- `emscripten_sleep()` cannot be used from inside a fiber:
  `emscripten_fiber_swap` leaves Asyncify's state at Rewinding while a fiber
  runs, so the shim's idle wait spins on a clock until a deadline instead.

## Layout

- `packages/core`, `packages/core-mt`: built wasm artifacts (single-thread,
  multi-thread). Not source, produced by the Docker build.
- `packages/ffmpeg`: the worker-based API that loads a core and runs it.
- `packages/util`: browser helper functions (fetchFile, etc).
- `packages/types`: shared TypeScript types.
- `src/pthread-fiber`: cooperative pthread shim (Emscripten fibers) the st
  core links so fftools' scheduler runs without `SharedArrayBuffer`.
- `build/patches/n9`: patches applied to FFmpeg n9.0.2's own fftools sources
  for both cores; see the comment in the Dockerfile's `ffmpeg-base` stage.
- `src/bind`: JS glue passed to emcc when building the core.
- `build/`: per-library build scripts used by the Dockerfile.
- `apps/`: standalone examples, not part of the pnpm workspace.
- `tests/`: browser tests run against built cores.
- `scripts/fate`, `scripts/bench`: run FFmpeg's FATE tests and benchmarks against
  the cores in CI. `baseline/` holds the committed results that
  `scripts/baseline/check.mjs` compares each run with, and
  `apps/website/docs/results.md` is generated from it. Refresh both with
  `node scripts/baseline/update.mjs <run-id>...` (see
  `apps/website/docs/fate-and-benchmarks.md`).

## Commands

- `pnpm install`
- `pnpm build`
- `pnpm lint`
- Core builds need Docker and are CI-only on low-memory dev machines: `make
  prd` (single-thread), `make prd-mt` (multi-thread).

## Glossary

- **core**: the emscripten-built `ffmpeg-core.js` / `ffmpeg-core.wasm`.
- **st / mt**: single-thread vs multithread core.
- **fftools**: FFmpeg's own CLI sources, patched at build time by
  `build/patches/n9` (see "FFmpeg upgrade plan").
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
