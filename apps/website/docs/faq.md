# FAQ

### Does ffmpeg.wasm support Node.js?

Yes. `@project516/ffmpeg-wasm` runs the same worker code in a `worker_threads`
Worker under Node.js instead of a browser Worker, and `load()` resolves the
core from `node_modules` by default instead of the jsDelivr CDN. See
[Usage](/docs/getting-started/usage#nodejs) for an example.

Node.js was unsupported from ffmpeg.wasm 0.12.0 through this fork's earlier
releases; if you are pinned to one of those, use
[fluent-ffmpeg](https://www.npmjs.com/package/fluent-ffmpeg) instead, or
upgrade.

### Why is ffmpeg.wasm so slow compared to native ffmpeg?

The core is built with `--disable-asm`, so FFmpeg and its libraries run
plain C code instead of the hand-written assembly and SIMD that native builds
use. Encoding is several times slower than native. Decoding
and remuxing are closer. See [Performance](/docs/performance) and
[FATE and benchmarks](/docs/fate-and-benchmarks) for measurements.

Ways to speed things up:

- Use `@project516/ffmpeg-wasm-core-mt` on a cross-origin isolated page.
  Threads run FFmpeg's pipeline and the encoders in parallel, at the cost of
  more memory and CPU. FFmpeg sees at most 4 cores, and a command that needs
  more threads than the pool has fails instead of hanging.
- Pick a faster preset: `-preset ultrafast` for x264, `-deadline realtime`
  for VP9.
- Remux with `-c copy` when you do not need to re-encode.
- Mount large inputs with `WORKERFS` instead of copying them in with
  `writeFile()`.
- Build a smaller core with a [preset](/docs/presets) if you only need a few
  codecs, which also shortens load time.

### Is RTSP supported by ffmpeg.wasm?

No. Browsers do not give WebAssembly raw TCP or UDP sockets, so network
protocols such as RTSP and RTMP cannot work. Fetch the input in JavaScript and
write it to the file system, or use WebRTC or MediaRecorder for live streams.

### Can ffmpeg.wasm decode AV1?

Yes, from the release after 0.16.0, through libdav1d, which the `full`,
`web` and `decode` presets link. There is no AV1 encoder.

### What is the license of ffmpeg.wasm?

There are two components inside ffmpeg.wasm:

- @project516/ffmpeg-wasm (https://github.com/Project516/ffmpeg.wasm/tree/master/packages/ffmpeg)
- @project516/ffmpeg-wasm-core (https://github.com/Project516/ffmpeg.wasm/tree/master/packages/core)

The whole project, including both packages, is licensed under AGPL-3.0-or-later. @project516/ffmpeg-wasm-core embeds FFmpeg built with `--enable-gpl` plus several GPL-licensed libraries (x264, x265), combined with this project's own AGPL-3.0-or-later code; see NOTICE at the repository root for the full list of bundled libraries and their licenses. @project516/ffmpeg-wasm is the wrapper that loads the core and calls its low-level APIs, and carries the same AGPL-3.0-or-later license.

### What is the maximum size of input file?

It depends on how the file gets in. FFmpeg's own memory is capped at 4 GB in
both cores: the single-thread core starts at 48 MB and grows on demand, the
multi-thread core starts at 1 GB. A file copied in with `writeFile()` also
needs room in the browser's memory, so large files fail well before 4 GB on
low-memory devices.

For big inputs, mount the `File` with `WORKERFS` instead, which reads it
lazily without copying:

```js
await ffmpeg.mount('WORKERFS', { files: [file] }, '/input');
await ffmpeg.exec(['-i', `/input/${file.name}`, 'output.mp4']);
await ffmpeg.unmount('/input');
```

`WORKERFS` mounts are read-only, so write outputs outside the mount point.

### Why are all log messages of type `stderr`?

FFmpeg writes its log, including the banner, progress and warnings, to
stderr, the same as native `ffmpeg`. Listen with `ffmpeg.on('log', ...)` to
read it. Only a few outputs, such as `ffprobe` results printed without
`-o`, go to stdout.

### Why do raw frames differ slightly from native FFmpeg?

Native FFmpeg uses assembly paths in swscale whose rounding differs a little
from the C code this build uses, so pixel values can be off by one. For
output closer to native, add `-sws_flags accurate_rnd+bitexact`.

### How do I decode a WebM video with transparency?

FFmpeg's built-in VP8 and VP9 decoders drop the alpha channel. Ask for the
libvpx decoder before the input:
`['-c:v', 'libvpx-vp9', '-i', 'input.webm', ...]`. The `full` preset, which
the published packages use, includes it.

### How can I build my own ffmpeg.wasm?

In fact, it is `@project516/ffmpeg-wasm-core` most people would like to build.

To build on your own, you can check [Contribution Guide](/docs/contribution/core)

Also you can check this series of posts to learn more fundamental concepts
(OUTDATED, but still good to learn foundations):

- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-1-preparation/
- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-2-compile-with-emscripten/
- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-3-v0.1/
- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-4-v0.2/
