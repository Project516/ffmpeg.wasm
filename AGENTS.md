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

Both cores now build FFmpeg n9.0.2. The ffmpeg CLI in fftools has needed a
threaded scheduler since 6.0; the mt core has real pthreads, the st core has
none (no `SharedArrayBuffer`), so it runs the scheduler on a cooperative
pthread shim instead.

1. Move the build toolchain (emsdk and libraries) to current releases. Done.
2. Port the fftools patches to the current FFmpeg release for the mt core.
   Done: `build/patches/n9` patches FFmpeg's own fftools sources at build
   time, replacing the vendored copies that used to live under
   `src/fftools`.
3. Give the st core a cooperative pthread shim on Emscripten fibers so the
   same fftools run without `SharedArrayBuffer`. Done: `src/pthread-fiber`
   implements the pthread subset fftools/libavutil use on top of
   Emscripten fibers, linked in via `-Wl,--wrap`. `src/fftools` (the old
   vendored n5.1.10 sources) is dead code kept until this is confirmed
   green in CI, then removed.
   Open: the st core hangs on video transcodes (`fate (st)`, `tests`,
   `node-tests`). Minimal reproducer, deterministic, sub-second when it
   works:

       ffmpeg -f lavfi -i pal100bars=rate=5:duration=1 -f null -

   The st core never returns from it. The mt core, which uses real
   threads and none of `src/pthread-fiber`, returns 0 in 0.1s, so this is
   the shim and not FFmpeg's scheduler. `pal100bars` hangs for every
   muxer, every `-pix_fmt`, every rate and every frame count tried;
   `pal75bars` with a byte-identical command passes, and so do
   `testsrc`, `testsrc2`, `rgbtestsrc`, `smptebars`, `nullsrc` and
   `allrgb` into `-f null`. `fate-filter-allrgb` and `fate-filter-allyuv`
   fail against `framecrc` but pass against `null`, which is why only
   some of the FATE filter tests fail.

   What it is not: a spin, and a deadlock. During a hang the shim prints
   nothing at all, which is the strongest evidence available, because its
   5s heartbeat is only reachable from `pfiber_reschedule` and its stall
   report fires on any fiber blocked past 10s. Neither fires. So the
   scheduler is never re-entered and no fiber is blocked: one fiber runs
   C for the whole run. Counting entries to every shim entry point
   (`pthread_mutex_lock`, `pthread_cond_timedwait`, `usleep`,
   `av_buffersink_get_frame_flags`, `avfilter_graph_request_oldest`,
   `avfilter_graph_config`) finds no loop through any of them either, so
   it is one long call and not a cycle.

   That also explains the whole history of this bug, wrongly read as a
   Heisenbug. Nothing about the hang is timing-sensitive: it reproduces
   every time. What changes with the code is the heap layout, because
   each fiber `malloc`s an 8MB C stack and an 8MB asyncify stack
   (`PFIBER_STACK_SIZE`, `PFIBER_ASYNCIFY_STACK_SIZE`, 80MB for the five
   fibers a transcode uses). Markers, an argv log line, an instrumented
   `_fd_write` and preemption all move those allocations, so each one
   changed the outcome without changing any logic. Read as a race, every
   attempt to observe it made it go away.

   So the next thing to look at is memory, not scheduling: whether a
   fiber's asyncify stack can be overflowed during an unwind. Emscripten's
   `emscripten_fiber_swap` unwinds the outgoing fiber onto that buffer and
   never checks it, and `pf_check_asyncify_stack` only runs after a switch
   has completed, so by the time it could report one the damage is done.


## Layout

- `packages/core`, `packages/core-mt`: built wasm artifacts (single-thread,
  multi-thread). Not source, produced by the Docker build.
- `packages/ffmpeg`: the worker-based API that loads a core and runs it.
- `packages/util`: browser helper functions (fetchFile, etc).
- `packages/types`: shared TypeScript types.
- `src/fftools`: vendored, patched FFmpeg n5.1.10 CLI sources. No longer
  built by either core; kept until the st core's move to n9.0.2 is
  confirmed green in CI, then removed.
- `src/pthread-fiber`: cooperative pthread shim (Emscripten fibers) the st
  core links so fftools' scheduler runs without `SharedArrayBuffer`.
- `build/patches/n9`: patches applied to FFmpeg n9.0.2's own fftools sources
  for both cores; see the comment in the Dockerfile's `ffmpeg-base` stage.
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
