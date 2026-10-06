# Performance

ffmpeg.wasm is FFmpeg compiled to WebAssembly, so it is slower than native
FFmpeg, even with the multithread core. This page sizes the gap on one
workload so you can decide whether ffmpeg.wasm fits your use case.

The numbers are measured by the CI benchmark job, which runs in Node on a
GitHub Actions runner, not in a browser. Browser results will differ. They are
refreshed at each release. The nightly run compares against them as a
regression watchdog and does not update them. See
[FATE and benchmarks](./fate-and-benchmarks.md) for how they are produced and
[FATE and benchmark results](./results.md) for the short 1 second cases.

## Environment

- Runner: GitHub Actions `ubuntu-latest`, shared hardware.
- Runtime: Node.js 22.
- Cores: `core` (single thread) and `core-mt` (multithread), both built from
  FFmpeg n9.0.2.
- Native: ffmpeg 6.1.1-3ubuntu5 from the runner image's package manager, not
  n9.0.2.

## Comparison

Setup:

- Command: `ffmpeg -i input.webm output.mp4`.
- Input: [Big Buck Bunny, 720p VP8, 10 seconds](https://test-videos.co.uk/vids/bigbuckbunny/webm/vp8/720/Big_Buck_Bunny_720_10s_1MB.webm),
  pinned by SHA-256 in `scripts/bench/run.mjs`.
- Each command runs 5 times, each in a fresh `node` process, and the median
  wall time is reported. The time includes process and core startup, which is
  small next to the transcode here.
- This case is measured nightly, not on every pull request.

|                | native FFmpeg | core (st) | core-mt |
| -------------- | ------------- | --------- | ------- |
| Median time    | 5.2 sec       | 82.0 sec  | 35.1 sec |
| Time vs native | 1x            | 15.7x     | 6.7x    |
| Peak memory    | 322 MB        | 496 MB    | 1033 MB |

The multithread core is about 2.3 times faster than the single-thread core on
this input, but needs `SharedArrayBuffer` and about twice the memory.

## Which core to use

The multithread core pays a fixed cost on every run: it starts a pool of
worker threads and reserves 1 GB of memory before it does any work. On a long
transcode that cost is small and the threads win. On a short job it is most of
the time, and the single-thread core is faster. From the CI benchmark, on 1 second
clips:

| case                  | core (st) | core-mt |
| --------------------- | --------- | ------- |
| H.264 to VP9          | 0.51 sec  | 1.04 sec |
| H.264 to MPEG-4       | 0.36 sec  | 0.93 sec |
| Scale to half size    | 1.12 sec  | 0.97 sec |
| Remux to MKV (`-c copy`) | 0.16 sec | 0.67 sec |
| 10 sec 720p VP8 to MP4 | 82.0 sec | 35.1 sec |

Use the single-thread core for remuxing (`-c copy`), probing, short clips,
low-memory devices, and pages that are not cross-origin isolated. Use the
multithread core to re-encode longer video on machines with spare cores and
memory.

## Earlier result

The previous version of this page measured v0.12.3 (FFmpeg n5.1.2) on the same
file and command, in Chrome 116 on an 11th Gen Intel Core i5-1135G7, timing
only `ffmpeg.exec()`. Native took 5.2 sec, core 128.8 sec (24.8x) and core-mt
60.4 sec (11.6x). The setups differ (browser on a laptop, then Node on a CI
runner), so treat the change as a rough indication, not a controlled
comparison.
