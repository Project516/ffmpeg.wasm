# @project516/ffmpeg-wasm-core

To build @project516/ffmpeg-wasm-core, make sure your docker is version 23.0+ as
[buildx](https://docs.docker.com/build/architecture/) is adopted. Also
You will need to install `make` to run build scripts.

## Build

Dev Build (single thread):
```bash
$ make dev
```

Dev Build (multithread):
```bash
$ make dev-mt
```

Production Build (single thread):
```bash
$ make prd
```

Production Build (multithread):
```bash
$ make prd-mt
```

> Each build might take around 1 hour depends on the spec of your machine,
> subsequent builds are faster as most layers are cached.

The output file locates at **/packages/core** or **/packages/core-mt**.

## Custom Build / Reduce Build Size

Pick a [preset](/docs/presets) to build a smaller core:

```bash
make prd PRESET=web
```

`full` is the default, `web` covers the common web codecs, and `decode` keeps
every decoder with only a few encoders. The presets are the files in
`build/presets/`. To include only the libraries and components you need,
copy one, edit its `FFMPEG_FLAGS` and `FFMPEG_LIBS`, and build with
`PRESET=<your file name without .env>`.

For a custom preset:

1. Start from `--disable-everything` and enable only what you use, for example
   `--enable-decoder=h264`, `--enable-encoder=libx264`, `--enable-muxer=mp4`.
   An external library needs both its `--enable-lib...` flag and the encoder
   or decoder that uses it.
2. Add the `-l...` flag of every enabled library to `FFMPEG_LIBS`. An
   `undefined reference` error at link time names a library you dropped from
   the list while a component still needs it.
3. Run `make prd PRESET=<name>` and check `packages/core/dist/`.

The library stages in the `Dockerfile` build for every preset. To skip one,
remove its builder stage and its `COPY --from=...` line in `ffmpeg-base`.

### More Advance Customization Example: Creating a Minimal Build

For more advanced customization, you might want to create a minimal build that only includes the features you need. A good example is creating a build that can create a video from a sequence of images (e.g., from an HTML canvas), handle MP4 encoding/decoding, and support audio.

A community member, @Kaizodo, shared an approach that resulted in a build size of only 4.80MB. You can find the full details and a discussion in [GitHub Issue #866](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/866).

The general strategy is to:

1.  **Start with a minimal configuration:** Instead of removing libraries one by one, a more effective approach is to start with a minimal ffmpeg configuration. This can be achieved by using flags like `--disable-everything` in `FFMPEG_FLAGS` of a preset file in `build/presets/`.
2.  **Enable specific components:** After disabling everything, you can selectively enable only the encoders, decoders, muxers, demuxers, and protocols you need for your specific use case. For example: `--enable-encoder=libx264`, `--enable-decoder=png`, `--enable-muxer=mp4`, etc.
3.  **Include only necessary libraries:** Make sure `FFMPEG_FLAGS` and `FFMPEG_LIBS` only list the external libraries that correspond to the features you enabled (e.g., `libx264`). You can remove the `Dockerfile` build stages for any other libraries.

This approach gives you control over the build content and its final size.

We would like to thank @Kaizodo, @harkdawg and other community members for sharing their knowledge!
## Publish

Simply run `pnpm publish` under **packages/core** or **/packages/core-mt**.
