# FATE and benchmark results

This page is generated from `baseline/fate.json` and `baseline/bench.json` by `node scripts/baseline/docs.mjs`. Do not edit it by hand. [FATE and benchmarks](./fate-and-benchmarks.md) explains how the numbers are produced and how to update them.

## Compatibility (FATE)

FFmpeg n9.0.2. The pass rate is pass divided by pass plus fail. A skipped test is one the runner could not run: its sample is missing from the FATE mirror, or it is a known failure listed below.

### Full subset (nightly)

| core | pass | fail | skip | total | pass rate |
| --- | --- | --- | --- | --- | --- |
| st | 1055 | 0 | 4 | 1059 | 100.0% |
| mt | 1055 | 0 | 4 | 1059 | 100.0% |

| test file | st pass / total | mt pass / total |
| --- | --- | --- |
| `filter-audio.mak` | 53 / 53 | 53 / 53 |
| `filter-video.mak` | 88 / 91 | 88 / 91 |
| `ffmpeg.mak` | 23 / 23 | 23 / 23 |
| `libswscale.mak` | 2 / 2 | 2 / 2 |
| `libswresample.mak` | 1 / 1 | 1 / 1 |
| `demux.mak` | 54 / 54 | 54 / 54 |
| `mov.mak` | 29 / 29 | 29 / 29 |
| `qt.mak` | 18 / 18 | 18 / 18 |
| `matroska.mak` | 7 / 8 | 7 / 8 |
| `mxf.mak` | 6 / 6 | 6 / 6 |
| `gif.mak` | 5 / 5 | 5 / 5 |
| `apng.mak` | 5 / 5 | 5 / 5 |
| `h264.mak` | 207 / 207 | 207 / 207 |
| `hevc.mak` | 16 / 16 | 16 / 16 |
| `vpx.mak` | 24 / 24 | 24 / 24 |
| `vvc.mak` | 2 / 2 | 2 / 2 |
| `mpeg4.mak` | 6 / 6 | 6 / 6 |
| `video.mak` | 122 / 122 | 122 / 122 |
| `image.mak` | 133 / 133 | 133 / 133 |
| `bmp.mak` | 13 / 13 | 13 / 13 |
| `prores.mak` | 10 / 10 | 10 / 10 |
| `dnxhd.mak` | 9 / 9 | 9 / 9 |
| `utvideo.mak` | 22 / 22 | 22 / 22 |
| `lossless-video.mak` | 16 / 16 | 16 / 16 |
| `jpeg2000.mak` | 15 / 15 | 15 / 15 |
| `hap.mak` | 13 / 13 | 13 / 13 |
| `ac3.mak` | 3 / 3 | 3 / 3 |
| `acodec.mak` | 1 / 1 | 1 / 1 |
| `opus.mak` | 1 / 1 | 1 / 1 |
| `audio.mak` | 9 / 9 | 9 / 9 |
| `adpcm.mak` | 52 / 52 | 52 / 52 |
| `pcm.mak` | 8 / 8 | 8 / 8 |
| `voice.mak` | 12 / 12 | 12 / 12 |
| `microsoft.mak` | 25 / 25 | 25 / 25 |
| `lossless-audio.mak` | 13 / 13 | 13 / 13 |
| `wavpack.mak` | 29 / 29 | 29 / 29 |
| `dca.mak` | 3 / 3 | 3 / 3 |

#### st core, full subset, failing and skipped tests

- `fate-filter-frei0r-filter` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-filter-unaligned` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-source` skipped: known failure: frei0r is not built into the cores
- `fate-matroska-prores-header-insertion-bz2` skipped: known failure: needs bzip2, which the cores are built without

#### mt core, full subset, failing and skipped tests

- `fate-filter-frei0r-filter` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-filter-unaligned` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-source` skipped: known failure: frei0r is not built into the cores
- `fate-matroska-prores-header-insertion-bz2` skipped: known failure: needs bzip2, which the cores are built without

### Fast subset (every pull request)

| core | pass | fail | skip | total | pass rate |
| --- | --- | --- | --- | --- | --- |
| st | 40 | 0 | 0 | 40 | 100.0% |
| mt | 40 | 0 | 0 | 40 | 100.0% |

| test file | st pass / total | mt pass / total |
| --- | --- | --- |
| `filter-audio.mak` | 12 / 12 | 12 / 12 |
| `filter-video.mak` | 12 / 12 | 12 / 12 |
| `ffmpeg.mak` | 5 / 5 | 5 / 5 |
| `libswscale.mak` | 2 / 2 | 2 / 2 |
| `libswresample.mak` | 1 / 1 | 1 / 1 |
| `mov.mak` | 3 / 3 | 3 / 3 |
| `ac3.mak` | 2 / 2 | 2 / 2 |
| `acodec.mak` | 1 / 1 | 1 / 1 |
| `opus.mak` | 1 / 1 | 1 / 1 |
| `voice.mak` | 1 / 1 | 1 / 1 |

## Performance

Median of five runs on one GitHub Actions runner, against native ffmpeg version 6.1.1-3ubuntu5 from the runner image, not the pinned tag. Most cases transcode a 1 second H.264 clip, so startup is a large part of their native time. The vp8-720p-to-mp4 case transcodes 10 seconds of 720p VP8 and is measured nightly only.

| case | native (ms) | st (ms) | st ratio | st peak RSS (MB) | mt (ms) | mt ratio | mt peak RSS (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| h264-to-vp9 | 120 | 510 | 4.25x | 215 | 1040 | 8.67x | 697 |
| h264-to-mpeg4 | 90 | 360 | 4.00x | 187 | 930 | 10.33x | 680 |
| scale-half | 90 | 1120 | 12.44x | 371 | 970 | 10.78x | 729 |
| vp8-720p-to-mp4 | 5210 | 81970 | 15.73x | 496 | 35110 | 6.74x | 1033 |
