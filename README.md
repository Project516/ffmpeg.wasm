---
<p align="center">
  <a href="#">
    <img alt="ffmpeg.wasm" width="128px" height="128px" src="https://github.com/Project516/ffmpeg.wasm/blob/master/apps/website/static/img/logo192.png"></img>
  </a>
</p>

# ffmpeg.wasm

This is a maintained fork of [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), which is no longer maintained.

ffmpeg.wasm is a pure Webassembly / Javascript port of FFmpeg. It enables video & audio record, convert and stream right inside browsers, and also runs in Node.js.

[![CI](https://github.com/Project516/ffmpeg.wasm/actions/workflows/CI.yml/badge.svg)](https://github.com/Project516/ffmpeg.wasm/actions/workflows/CI.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Install

```sh
pnpm add @project516/ffmpeg-wasm @project516/ffmpeg-wasm-util
```

The fork publishes under the `@project516` npm scope. The packages are drop-in replacements for `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core`, and `@ffmpeg/core-mt`: change the import paths and keep the same API.

## Documentation

- [Introduction](https://project516.dev/ffmpeg.wasm/docs/overview)
- [Getting
    Started](https://project516.dev/ffmpeg.wasm/docs/getting-started/installation)
- [API](https://project516.dev/ffmpeg.wasm/docs/api/ffmpeg/)
- [FAQ](https://project516.dev/ffmpeg.wasm/docs/faq)
- [Contribution](https://project516.dev/ffmpeg.wasm/docs/contribution/core)
