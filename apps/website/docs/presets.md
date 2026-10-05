# Core presets

A preset decides which FFmpeg components and external libraries a core build
includes. The published `@project516/ffmpeg-wasm-core` and `-core-mt`
packages are built with `full`. The smaller presets are for people who build
their own core and want a smaller download.

| preset | contents |
| --- | --- |
| `full` | Everything: x264, x265, libvpx, lame, theora, vorbis, opus, webp, freetype, fribidi, libass and zimg, with all of FFmpeg's decoders, encoders, muxers, demuxers and filters. |
| `web` | The codecs and containers web video and audio use. Decoders for h264, hevc, vp8, vp9, mpeg4, mjpeg, png, gif, webp, aac, mp3, opus, vorbis, flac, alac and PCM. Encoders for h264 (x264), vp8 and vp9 (libvpx), aac, opus, mp3, vorbis, flac, png, mjpeg, gif and webp. mp4, mov, webm, matroska, ogg, mp3, flac, wav, gif and image demuxers and muxers, and the common filters (scale, crop, pad, transpose, fps, overlay, concat, volume, amix, atempo, and others). No x265, theora, subtitle rendering or `lavfi` sources. |
| `decode` | Every decoder, demuxer, parser, protocol and filter that `full` has, so any input plays. Only the png, mjpeg, rawvideo and PCM encoders, and the null, image2, wav, rawvideo, framecrc, framemd5, md5, crc and hash muxers. No encoder libraries. It is linked at `-O2`, because `wasm-opt -O3` crashes on it. |

The preset files are `build/presets/<name>.env`. Each sets `FFMPEG_FLAGS`
(configure flags), `FFMPEG_LIBS` (libraries to link) and, optionally,
`FFMPEG_LINK_FLAGS` (extra emcc link flags). A preset is a plain list, so
copy one to start your own.

## Size

Measured in CI at FFmpeg n9.0.2, from `dist/umd`. Gzip is level 9. The last
column adds the gzipped `ffmpeg-core.js`.

| preset | core | wasm (MB) | wasm gzip (MB) | wasm and js gzip (MB) |
| --- | --- | --- | --- | --- |
| `full` | single-thread | 39.96 | 13.44 | 13.48 |
| `full` | multi-thread | 32.36 | 11.05 | 11.08 |
| `web` | single-thread | 14.89 | 4.84 | 4.87 |
| `web` | multi-thread | 12.30 | 4.01 | 4.04 |
| `decode` | single-thread | 25.31 | 9.00 | 9.04 |
| `decode` | multi-thread | 20.22 | 7.46 | 7.50 |

Each `build-preset` job in the CI workflow prints its row in the job summary,
so a change that moves these numbers shows up in a pull request.

## Build one

```bash
make prd PRESET=web          # single-thread
make prd-mt PRESET=web       # multi-thread
```

`PRESET` defaults to `full`. The library stages in the `Dockerfile` (x264,
x265 and the rest) build for every preset, and the preset only changes what
FFmpeg enables and what the core links, so the first build of a small preset
is as slow as a full one. Later builds reuse the cached library layers.

CI builds `web` and `decode` for both cores, checks that each core has the
codecs its preset lists and none that it leaves out, and runs a short decode
and encode (`scripts/preset-check.mjs`).

A smaller core fails on a command that needs a component it left out, for
example `Unknown encoder 'libx265'` or `Unrecognized option` for a missing
filter. Check the preset's file before filing a bug.
