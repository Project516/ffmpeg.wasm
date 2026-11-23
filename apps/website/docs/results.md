# FATE and benchmark results

This page is generated from `baseline/fate.json` and `baseline/bench.json` by `node scripts/baseline/docs.mjs`. Do not edit it by hand. [FATE and benchmarks](./fate-and-benchmarks.md) explains how the numbers are produced and how to update them.

## Compatibility (FATE)

FFmpeg n9.1. The pass rate is pass divided by pass plus fail. A skipped test is one the runner could not run: its sample is missing from the FATE mirror, or it is a known failure listed below.

### Full subset (pull requests)

| core | pass | fail | skip | total | pass rate |
| --- | --- | --- | --- | --- | --- |
| st | 1164 | 1 | 6 | 1171 | 99.9% |
| mt | 1164 | 1 | 6 | 1171 | 99.9% |

| test file | st pass / total | mt pass / total |
| --- | --- | --- |
| `filter-audio.mak` | 53 / 53 | 53 / 53 |
| `filter-video.mak` | 120 / 126 | 120 / 126 |
| `ffmpeg.mak` | 78 / 78 | 78 / 78 |
| `libswscale.mak` | 6 / 6 | 6 / 6 |
| `libswresample.mak` | 1 / 1 | 1 / 1 |
| `demux.mak` | 54 / 54 | 54 / 54 |
| `mov.mak` | 30 / 30 | 30 / 30 |
| `qt.mak` | 18 / 18 | 18 / 18 |
| `matroska.mak` | 8 / 9 | 8 / 9 |
| `mxf.mak` | 6 / 6 | 6 / 6 |
| `gif.mak` | 5 / 5 | 5 / 5 |
| `apng.mak` | 5 / 5 | 5 / 5 |
| `h264.mak` | 210 / 210 | 210 / 210 |
| `hevc.mak` | 18 / 18 | 18 / 18 |
| `vpx.mak` | 25 / 25 | 25 / 25 |
| `vvc.mak` | 4 / 4 | 4 / 4 |
| `mpeg4.mak` | 6 / 6 | 6 / 6 |
| `video.mak` | 123 / 123 | 123 / 123 |
| `image.mak` | 133 / 133 | 133 / 133 |
| `bmp.mak` | 13 / 13 | 13 / 13 |
| `prores.mak` | 10 / 10 | 10 / 10 |
| `dnxhd.mak` | 9 / 9 | 9 / 9 |
| `utvideo.mak` | 22 / 22 | 22 / 22 |
| `lossless-video.mak` | 16 / 16 | 16 / 16 |
| `jpeg2000.mak` | 15 / 15 | 15 / 15 |
| `hap.mak` | 13 / 13 | 13 / 13 |
| `ac3.mak` | 4 / 4 | 4 / 4 |
| `acodec.mak` | 2 / 2 | 2 / 2 |
| `opus.mak` | 1 / 1 | 1 / 1 |
| `audio.mak` | 11 / 11 | 11 / 11 |
| `adpcm.mak` | 54 / 54 | 54 / 54 |
| `pcm.mak` | 9 / 9 | 9 / 9 |
| `voice.mak` | 12 / 12 | 12 / 12 |
| `microsoft.mak` | 25 / 25 | 25 / 25 |
| `lossless-audio.mak` | 13 / 13 | 13 / 13 |
| `wavpack.mak` | 31 / 31 | 31 / 31 |
| `dca.mak` | 1 / 1 | 1 / 1 |

#### st core, full subset, failing and skipped tests

- `fate-filter-scale_cuda-resize-step-p010` fails: ffmpeg exited -28
- `fate-filter-fps-single-zero-duration` skipped: no reference file
- `fate-filter-fps-single-cross-start` skipped: no reference file
- `fate-filter-frei0r-filter` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-filter-unaligned` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-source` skipped: known failure: frei0r is not built into the cores
- `fate-matroska-prores-header-insertion-bz2` skipped: known failure: needs bzip2, which the cores are built without

#### mt core, full subset, failing and skipped tests

- `fate-filter-scale_cuda-resize-step-p010` fails: ffmpeg exited -28
- `fate-filter-fps-single-zero-duration` skipped: no reference file
- `fate-filter-fps-single-cross-start` skipped: no reference file
- `fate-filter-frei0r-filter` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-filter-unaligned` skipped: known failure: frei0r is not built into the cores
- `fate-filter-frei0r-source` skipped: known failure: frei0r is not built into the cores
- `fate-matroska-prores-header-insertion-bz2` skipped: known failure: needs bzip2, which the cores are built without

### Fast subset (pushes to master)

| core | pass | fail | skip | total | pass rate |
| --- | --- | --- | --- | --- | --- |
| st | 40 | 0 | 0 | 40 | 100.0% |
| mt | 40 | 0 | 0 | 40 | 100.0% |

| test file | st pass / total | mt pass / total |
| --- | --- | --- |
| `filter-audio.mak` | 9 / 9 | 9 / 9 |
| `filter-video.mak` | 8 / 8 | 8 / 8 |
| `ffmpeg.mak` | 6 / 6 | 6 / 6 |
| `libswscale.mak` | 6 / 6 | 6 / 6 |
| `libswresample.mak` | 1 / 1 | 1 / 1 |
| `mov.mak` | 3 / 3 | 3 / 3 |
| `ac3.mak` | 3 / 3 | 3 / 3 |
| `acodec.mak` | 2 / 2 | 2 / 2 |
| `opus.mak` | 1 / 1 | 1 / 1 |
| `voice.mak` | 1 / 1 | 1 / 1 |

## Performance

Median of five runs on one GitHub Actions runner, against native ffmpeg version 8.0.1-3ubuntu2 from the runner image, not the pinned tag. Most cases transcode a 1 second H.264 clip, so startup is a large part of their native time. The vp8-720p-to-mp4 case transcodes 10 seconds of 720p VP8 and is measured only on manual CI runs with subset=full. A "-" means the case has no result for that core yet.

| case | native (ms) | st (ms) | st ratio | st peak RSS (MB) | mt (ms) | mt ratio | mt peak RSS (MB) | jspi (ms) | jspi ratio | jspi peak RSS (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h264-to-vp9 | 80 | 320 | 4.00x | 215 | 770 | 9.63x | 644 | 260 | 3.25x | 173 |
| h264-to-x264 | 60 | 340 | 5.67x | 241 | 800 | 13.33x | 663 | 270 | 4.50x | 199 |
| h264-to-mpeg4 | 60 | 250 | 4.17x | 173 | 750 | 12.50x | 621 | 170 | 2.83x | 149 |
| scale-half | 60 | 350 | 5.83x | 232 | 790 | 13.17x | 655 | 290 | 4.83x | 188 |
| h264-remux-mkv | 50 | 170 | 3.40x | 157 | 760 | 15.20x | 585 | 140 | 2.80x | 140 |
| vp8-720p-to-mp4 | 3000 | 42530 | 14.18x | 426 | 17630 | 5.88x | 841 | 41180 | 13.73x | 357 |
