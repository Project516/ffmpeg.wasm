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
| h264-to-vp9 | 110 | 530 | 4.82x | 216 | 1200 | 10.91x | 637 | 420 | 3.82x | 176 |
| h264-to-x264 | 80 | 530 | 6.63x | 242 | 1250 | 15.63x | 666 | 440 | 5.50x | 201 |
| h264-to-mpeg4 | 80 | 380 | 4.75x | 172 | 1120 | 14.00x | 621 | 260 | 3.25x | 148 |
| scale-half | 80 | 510 | 6.38x | 233 | 1150 | 14.38x | 649 | 450 | 5.63x | 198 |
| h264-remux-mkv | 70 | 260 | 3.71x | 158 | 1050 | 15.00x | 576 | 220 | 3.14x | 140 |
| vp8-720p-to-mp4 | 5120 | 68900 | 13.46x | 408 | 31590 | 6.17x | 834 | 66610 | 13.01x | 363 |
