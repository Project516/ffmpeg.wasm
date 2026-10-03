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
   `node-tests`). The stall is the filtering thread's poll loop in
   `fftools/ffmpeg_filter.c`, not the muxer. `filter_thread` calls
   `sch_filter_receive`, which drains with `THREAD_QUEUE_FLAG_NO_BLOCK`
   and then calls `waiter_wait`; while the filtergraph is unchoked,
   `waiter_wait` returns without touching a pthread primitive, and both
   `av_buffersink_get_frame_flags` and `avfilter_graph_request_oldest`
   come straight back `EAGAIN`. So one pass of that loop contends no
   mutex and blocks nowhere, which on a single threaded core is a spin.
   The muxer fiber is absent as a symptom, not a cause: it is created
   lazily by `sch_mux_stream_ready` -> `mux_init`, which runs out of
   `enc_open`, which needs the first frame out of the graph.

   This is why every attempt to observe the hang made it go away. The
   shim's stall reports and its 5s heartbeat are reachable only from
   `pfiber_reschedule`, and the spin never reaches `pfiber_reschedule`
   at all, so they print nothing during the hang. Anything that adds work
   to the loop (markers in `filter_thread`, an argv log line, an
   instrumented `_fd_write`) perturbs when the loop's yield fires and
   moves the frame that gets observed. Instrument to find it and it hides,
   so the fix has to be robust rather than diagnostic.

   The yield itself lives in the two `--wrap`ed libavfilter calls, which
   are the only points in that loop the shim sees: `fg_output_step` calls
   `av_buffersink_get_frame_flags` once per output and `read_frames`
   calls `avfilter_graph_request_oldest` once per pass. The budget for
   it is wall clock per fiber (`PF_PREEMPT_MS`), not a count of calls. A
   call count cannot mean the same thing twice, since a pass that rejects
   `EAGAIN` takes microseconds and one that produces a frame takes
   hundreds of milliseconds; a single global count was worse still,
   because `pfiber_reschedule` reset it on every switch, so a spinning
   fiber never reached its threshold at all whenever the rest of the
   pipeline was busy. Measured in isolation: the old scheme yields zero
   times across a 1000ms spin with one other fiber switching throughout,
   where the per-fiber 5ms budget yields 200 times.

   That work also found a real, separate bug: `g_main`'s stack limits are never
   restored, because `emscripten_fiber_init_from_current_context` does not record
   the module stack in `g_main.ctx`. The module stack is 5MB at
   `0xe47650..0x1347650` and the limits left in force are a fiber's 8MB
   range, so the run fails its own `stackRestore` in `bind.js` with
   `Attempt to set SP to 0x01347650, with stack limits
   [0x02b89b68 - 0x03389b68]`. This branch now restores the module stack bounds
   captured during reset when control comes back to `g_main`.

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
