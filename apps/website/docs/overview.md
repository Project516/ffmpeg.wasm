import MuiThemeProvider from "@site/src/components/common/MuiThemeProvider";
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';

# Overview

:::info
For 0.11.x, visit [https://ffmpegwasm-0-11-x.netlify.app](https://ffmpegwasm-0-11-x.netlify.app)
and [0.11.x](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/0.11.x) branch.
:::

## Introduction

ffmpeg.wasm is a pure WebAssembly / JavaScript port of [FFmpeg](https://www.ffmpeg.org/)
enabling video & audio record, convert and stream right inside browsers.

We leverage
[Emscripten](https://emscripten.org/) to transpile FFmpeg source code and many
libraries to WebAssembly and develop a minimal but essential library to free
developers from common requirements like running ffmpeg inside web worker and
more.

## Advantages

- **Security**: your users' data only lives inside their browser, no need to
    worry about any data leakage or network latency.
- **Client-side computing**: instead of hosting a cluster of server-end servers,
    you can now offload multimedia processing to client-side.
- **Flexible**: ffmpeg.wasm comes with single-thread and multi-thread cores, you
    can use whichever fits your use case.

## Architecture

![architecture](/img/ffmpegwasm-arch.png)

Multimedia transcoding is a resource-intensive task that you don't want to
execute in main thread, thus in ffmpeg.wasm we offload those task to web worker
(`ffmpeg.worker`) by default. This makes almost all function calls in ffmpeg.wasm
are asynchronous and it is recommended to use **async** / **await** syntax.

`ffmpeg.worker` downloads WebAssembly code (`ffmpeg-core`) from CDN
and initialized it in WorkerGlobalScope. For any input video file you would like
to process, you need to first populated them inside ffmpeg-core File System and
also read result from `ffmpeg-core` File System once it is done.

If you are using a multi-thread version of `ffmpeg-core`, more web workers will
be spawned by `ffmpeg-core` inside `ffmpeg.worker`

:::info
The concept of `core` in ffmpeg.wasm is like the engine of a car, it is not only
the most important part of ffmpeg.wasm but also a swappable component. Currently
we maintain single-thread (`@project516/ffmpeg-wasm-core`) and multi-thread version
(`@project516/ffmpeg-wasm-core-mt`) cores, you can build your own core (ex. a core with x264
 lib only to minimize ffmpeg-core.wasm file size) using build scripts in the repository.
:::

## Packages

All ffmpeg.wasm packages are under [@project516](https://www.npmjs.com/search?q=%40project516)
name space:

| Name | Usage |
| ---- | ----- |
| @project516/ffmpeg-wasm | ffmpeg.wasm main package |
| @project516/ffmpeg-wasm-util | common utility functions |
| @project516/ffmpeg-wasm-types | TypeScript types |
| @project516/ffmpeg-wasm-core | single-thread ffmpeg.wasm core |
| @project516/ffmpeg-wasm-core-mt | multi-thread ffmpeg.wasm core |

## Libraries

ffmpeg.wasm is built with toolchains / libraries:

<MuiThemeProvider>
    <TableContainer>
      <Table sx={{ minWidth: 650 }} aria-label="simple table">
        <TableHead>
          <TableRow>
            <TableCell align="center">Name</TableCell>
            <TableCell align="center">Version</TableCell>
            <TableCell align="center">Note</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {[
            {name: "Emscripten", version: "6.0.10", note: "Emscripten is a toolchain for compiling C and C++ code into WebAssembly and JavaScript, making it possible to run applications written in these languages in web browsers. Version is the emsdk Docker image tag."},
            {name: "FFmpeg", version: "n5.1.10", note: "FFmpeg is a powerful multimedia framework that can decode, encode, transcode, and stream audio and video files. Pinned to 5.1.x because the ffmpeg CLI needs real pthreads since 6.0; see \"FFmpeg upgrade plan\" in AGENTS.md."},
            {name: "x264", version: "4-cores (branch)", note: "x264 is a popular video encoding library that provides high-quality H.264 video compression. Built from the ffmpegwasm mirror's 4-cores branch; upstream x264 has no stable release tags to move to."},
            {name: "x265", version: "4.2", note: "x265 is a video encoding library that specializes in encoding videos using the H.265/HEVC codec, offering high compression efficiency for video content. Built from canonical upstream (multicoreware/x265_git)."},
            {name: "libvpx", version: "v1.17.0", note: "libvpx is an open-source video codec library used for encoding and decoding VP8 and VP9 video formats, commonly used for web-based video streaming. Built from canonical upstream (webmproject/libvpx)."},
            {name: "lame", version: "master (branch)", note: "LAME is an audio encoder that converts audio files to the MP3 format, making it widely used for creating MP3 audio files. Built from the ffmpegwasm mirror's master branch; upstream LAME has not tagged a release since 3.100 (2017)."},
            {name: "ogg", version: "v1.3.6", note: "Ogg is a multimedia container format, and this library provides support for encoding and decoding audio and video in the Ogg format. Built from canonical upstream (xiph/ogg)."},
            {name: "theora", version: "v1.1.1", note: "Theora is an open video codec designed for efficient video compression within the Ogg multimedia framework. Built from canonical upstream (xiph/theora); no release since 2010."},
            {name: "opus", version: "v1.6.1", note: "Opus is a versatile audio codec capable of handling both voice and music with low latency and high-quality compression. Built from canonical upstream (xiph/opus)."},
            {name: "vorbis", version: "v1.3.7", note: "Vorbis is an open-source audio codec known for its high audio quality and efficient compression. Built from canonical upstream (xiph/vorbis)."},
            {name: "zlib", version: "v1.3.2", note: "zlib is a compression library that provides data compression and decompression functionality, commonly used in file compression formats like gzip. Built from canonical upstream (madler/zlib)."},
            {name: "libwebp", version: "v1.6.0", note: "libwebp is a library for working with the WebP image format, offering efficient image compression for web use. Built from canonical upstream (webmproject/libwebp)."},
            {name: "freetype2", version: "VER-2-14-3 (2.14.3)", note: "FreeType 2 is a library for rendering fonts. Built from canonical upstream, which moved to gitlab.freedesktop.org."},
            {name: "fribidi", version: "v1.0.17", note: "FriBidi is a library for handling bidirectional text (text containing both left-to-right and right-to-left scripts) and is often used in text layout and rendering."},
            {name: "harfbuzz", version: "8.5.0", note: "HarfBuzz is a text shaping engine that allows complex script text to be rendered correctly. Pinned to the last release before harfbuzz dropped its autotools build for meson-only."},
            {name: "libass", version: "0.17.5", note: "libass is a library for rendering and formatting subtitles in multimedia applications, making it essential for displaying subtitles alongside video content."},
            {name: "zimg", version: "release-3.0.6 (3.0.6)", note: "zimg implements the commonly required image processing basics of scaling, colorspace conversion, and depth conversion."}
           ].map((row) => (
            <TableRow
              key={row.name}
            >
              <TableCell component="th" scope="row">
                {row.name}
              </TableCell>
              <TableCell align="left">{row.version}</TableCell>
              <TableCell align="left">{row.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
</MuiThemeProvider>
