# FAQ

### Why ffmpeg.wasm doesn't support nodejs?

ffmpeg.wasm did support nodejs before 0.12.0, but decided to discontinue nodejs support due to:

- It takes extra effort to maintain nodejs support
- If you are not in browser, there are a lot of better choices than using WebAssembly for a better performance, ex:
  - nodejs: https://www.npmjs.com/package/fluent-ffmpeg
  - react-native: https://github.com/arthenica/ffmpeg-kit

Of course, it is still highly welcome to contribute a nodejs version of ffmpeg.wasm.

### Why ffmpeg.wasm is so slow comparing to ffmpeg?

As of now, WebAssembly is still a lot slower than native, it is possible to further speed up using
WebAssembly intrinsic, which is basically writing assembly code. It is something we are investigating
and hope to introduce in the future.

If you are OK with more unstable version of ffmpeg.wasm, using ffmpeg.wasm multithread (mt) version
can have around 2x speed comparing to single thread (but consume a lot more memory and cpu)

### Is RTSP supported by ffmpeg.wasm?

We are trying to support, but so far WebAssembly itself lack of features like sockets which makes
it hard to implement RTSP protocol. Possible workarounds are still under investigation.

### What is the license of ffmpeg.wasm?

There are two components inside ffmpeg.wasm:

- @project516/ffmpeg-wasm (https://github.com/Project516/ffmpeg.wasm/tree/master/packages/ffmpeg)
- @project516/ffmpeg-wasm-core (https://github.com/Project516/ffmpeg.wasm/tree/master/packages/core)

The whole project, including both packages, is licensed under AGPL-3.0-or-later. @project516/ffmpeg-wasm-core embeds FFmpeg built with `--enable-gpl` plus several GPL-licensed libraries (x264, x265), combined with this project's own AGPL-3.0-or-later code; see NOTICE at the repository root for the full list of bundled libraries and their licenses. @project516/ffmpeg-wasm is the wrapper that loads the core and calls its low-level APIs, and carries the same AGPL-3.0-or-later license.

### What is the maximum size of input file?

2 GB, which is a hard limit in WebAssembly. Might become 4 GB in the future.

### How can I build my own ffmpeg.wasm?

In fact, it is `@project516/ffmpeg-wasm-core` most people would like to build.

To build on your own, you can check [Contribution Guide](/docs/contribution/core)

Also you can check this series of posts to learn more fundamental concepts
(OUTDATED, but still good to learn foundations):

- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-1-preparation/
- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-2-compile-with-emscripten/
- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-3-v0.1/
- https://jeromewu.github.io/build-ffmpeg-webassembly-version-part-4-v0.2/
