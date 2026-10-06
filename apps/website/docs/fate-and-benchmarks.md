# FATE and benchmarks

The `fate` and `benchmark` jobs in the CI workflow
(`.github/workflows/CI.yml`) measure the st and mt cores against FFmpeg's
own test suite (FATE) and against native FFmpeg, so compatibility and
performance are tracked over time instead of assumed. The idea and the
pass/fail/skip and wasm/native ratio framing come from
[wasmpeg](https://github.com/wasmpeg/wasmpeg)'s `COMPAT.md` and
`CORRECTNESS.md` (LGPL-2.1-or-later).

The current numbers are on [FATE and benchmark results](./results.md), a page
generated from the committed baseline.

The `fate` and `benchmark` jobs are **not required checks**. A failing FATE
test does not fail them. The `baseline-check` job compares each run with the
baseline in `baseline/` and goes red on a regression, so a change that breaks
a test that used to pass is visible on the pull request. It is not a required
check either.

## What it measures

### Compatibility (FATE)

FFmpeg ships its own test definitions and reference output under
`tests/fate/*.mak` and `tests/ref/fate/` in its source tree. Each test names
an ffmpeg command line and, for the tests this workflow covers, a reference
`framecrc` or `framemd5` checksum file.

`scripts/fate/` reads those definitions for the FFmpeg tag pinned in the
Dockerfile (`FFMPEG_VERSION_ST` / `FFMPEG_VERSION_MT`), picks a subset from
`scripts/fate/config.mjs`'s allowlist of `.mak` files (mp4/mov and Matroska
demuxing, the h264, hevc, vp8/vp9 and many older video decoders, audio
decoders, images, and the scale and other filters), runs the equivalent
command inside the built core under Node, and diffs the result against the
reference file. The runner handles the `framecrc`, `framemd5`, `crc`, `md5`
and `md5pipe` test shapes. This is a
small, from-scratch reader of that convention, not a port of FFmpeg's
`tests/fate-run.sh`. In CI, that sparse checkout is cached per pinned tag
(`actions/cache`, keyed on the tag), so a cache hit skips the clone entirely.

Two subsets exist:

- **fast**: 40 tests that need no samples from the FATE samples mirror, run
  on every pull request. Most of these tests need an input file FFmpeg itself generates
  for FATE, e.g. a synthetic WAV via `tests/audiogen.c`.
  `scripts/fate/lib/gen.mjs` compiles that tool (and `tests/videogen.c`, for
  tests that need it) with the host C compiler and runs it into the core's
  virtual filesystem, so this subset needs no `lavfi`-only tests to avoid
  that mirror. It still fetches FFmpeg's own `tests/fate/*.mak` and
  `tests/ref/fate/` from GitHub (`scripts/fate/fetch-defs.mjs`'s sparse
  checkout), so it is not network-free.
- **full**: every selected test, including the sample-backed ones, fetched
  over rsync from the FATE samples mirror (`fate-suite.ffmpeg.org`), limited
  to exactly the samples those tests reference. Runs nightly and on manual
  dispatch.

A test that is known to fail on a core is listed with a reason in
`KNOWN_FAILURES` in `scripts/fate/config.mjs`. It is reported as skipped
and never run, so a hang cannot cost the job its per-test timeout.

A test whose command line references a fixture this runner cannot produce at
all (a copy from the FFmpeg source tree, a multi-frame image sequence, ...)
is left out of a subset during selection; `counts.unsupported` in a manifest
tracks how many. A test that is selected but whose input is missing at run
time (a sample not fetched, or a generated file that failed to build) is
reported "skip" with a reason by `scripts/fate/run.mjs`, not "fail".

Results are recorded per core as pass/fail/skip counts and a per-test list,
written as JSON and uploaded as workflow artifacts (`fate-results-st`,
`fate-results-mt`), and summarized as a markdown table in the workflow's
step summary.

This is not the pass rate FFmpeg reports upstream. It only covers the `.mak`
files listed in `scripts/fate/config.mjs` and the test shapes above. The
decoder tests that compare against a reference file with a tolerance
(`pcm` and `ffmpeg` tests with a `REF` file and `CMP = oneoff` or `stddev`,
which is how most AAC, MP3, FLAC and Opus decoding is tested upstream) are
not covered yet, and neither are the tests that need `ffprobe` or several
commands in sequence.

### Performance (benchmarks)

`scripts/bench/run.mjs` runs a fixed, small set of transcodes on native
FFmpeg and on each core, on the same GitHub Actions runner, using the same
1-second H.264 sample the browser and Node tests already embed
(`tests/test-helper-browser.js`). That sample is video-only, so the fixed set
is:

- H.264 to VP9 (`libvpx-vp9`)
- H.264 to MPEG-4 (container remux to a different codec)
- a `scale` filter pass

Each sample (one case, one run) is a fresh `node` child process, spawned
under `/usr/bin/time -v`, whether it runs native ffmpeg or a core: that gives
native and wasm the same wall-clock and peak-RSS measurement, taken by the
same external tool, rather than the core's own `process.hrtime`/
`memoryUsage()` (current, not peak) against native's `/usr/bin/time`.
`scripts/bench/report.mjs` combines the native and core results into one
report with a wasm/native time ratio per case, written as JSON
(`bench-report.json`) and as a markdown table in the step summary.

A fourth case, `vp8-720p-to-mp4`, runs `-i input.webm output.mp4` on 10
seconds of 720p VP8 (Big Buck Bunny from test-videos.co.uk, pinned by
SHA-256, downloaded at run time). It takes minutes on the st core, so it runs
only in nightly mode (the schedule, or a manual dispatch with `subset=full`),
through `--include-long`. Pull request runs skip it, and `check.mjs` only
compares the cases a run has. Refresh the baseline from a nightly run, or the
case is dropped from `baseline/bench.json`.

Each sample is run five times and the median is reported, so one slow run on
a shared runner does not move the result.

Because the sample is 1 second of video, most cases finish in well under a
second even natively (tens to a few hundred milliseconds), so a fixed part of
that time is process/runtime startup rather than transcoding. The wasm/native
*ratio* is still meaningful (both sides pay a startup cost), but the absolute
wall-clock numbers should not be read as "this transcode takes N ms" for
anything longer than the sample. Passing a longer sample through this same
harness is a reasonable follow-up if absolute numbers become useful.

Native FFmpeg here is whatever `apt-get install ffmpeg` resolves to on the
`ubuntu-latest` runner image, not a build of the exact pinned FFmpeg tag;
the workflow records `ffmpeg -version` in its log so the actual native
version used is visible. This keeps the benchmark simple and reproducible
per runner image; pinning a static build of the exact tag is a reasonable
follow-up.

## Regression detection

`baseline/fate.json` records, for each core and subset, which tests passed,
failed and were skipped. `baseline/bench.json` records each core's median
wasm/native time ratio and peak memory for each benchmark case.
`scripts/baseline/check.mjs` compares a run with them, and the
`baseline-check` job runs it and writes the comparison to the step summary.
It fails when:

- a FATE test that passed in the baseline fails now, or a core's results are
  missing;
- a benchmark case has no successful run, or its time ratio or peak memory is
  more than 50% above the baseline.

It warns, without failing, when a passing test is skipped or not run, and when
a benchmark metric is more than 20% above the baseline. The benchmark compares
the ratio to native, not milliseconds, so a faster or slower runner moves both
sides. The thresholds are `BENCH_WARN` and `BENCH_FAIL` in
`scripts/baseline/compare.mjs`. Native FFmpeg takes about 100 ms in these
cases and the timer resolves 10 ms, so the failure threshold is wide on
purpose.

## Updating the baseline

Update the baseline when a change fixes tests, adds tests to the allowlist,
changes the FFmpeg tag, or moves a benchmark on purpose.

1. Run the CI workflow by hand once per subset, so both baselines refresh.
   Wait for each run to finish.

   ```sh
   gh workflow run CI --ref <branch> -f subset=fast
   gh workflow run CI --ref <branch> -f subset=full
   ```

   Runs of one workflow on one ref cancel each other, so start the second
   after the first finishes. A pull request run also counts as a fast run.

2. Write the baseline and regenerate the results page from those runs.

   ```sh
   node scripts/baseline/update.mjs <fast-run-id> <full-run-id>
   ```

   It downloads the `fate-results-*` and `bench-results` artifacts with `gh`,
   or reads a directory that already holds them.

3. Commit `baseline/` and `apps/website/docs/results.md` in a pull request.
   The `js` job fails if the results page does not match the baseline.

## Running it locally

The scripts need Docker-built cores (`packages/core/dist`,
`packages/core-mt/dist`), so they are meant to run after `make prd` /
`make prd-mt`, or against cores downloaded from a CI run. They also fetch
FFmpeg's test definitions from the network (and, for the full subset,
samples from the FATE mirror over rsync), so do not run them on a machine
where that download is unwanted.

```sh
# 1. Fetch FFmpeg's tests/ directory for the pinned tag (sparse checkout).
node scripts/fate/fetch-defs.mjs --tag n9.0.2

# 2. Pick a subset and write it as a manifest.
node scripts/fate/select.mjs --tag n9.0.2 --subset fast --out manifest.json

# 3. Fetch any samples that subset's tests reference (no-op for "fast").
node scripts/fate/fetch-samples.mjs --manifest manifest.json --tag n9.0.2

# 4. Run it against a built core and write results.
node scripts/fate/run.mjs --core packages/core --label st --manifest manifest.json --out results.json

# Benchmarks: native, then each core, then combine.
node scripts/bench/run.mjs --native --out bench-native.json
node scripts/bench/run.mjs --core packages/core --label st --out bench-st.json
node scripts/bench/report.mjs --native bench-native.json --core bench-st.json --out bench-report.json --markdown-out bench-report.md

# Compare with the committed baseline.
node scripts/baseline/check.mjs --fate results.json --bench bench-report.json
```

## Where the results are

- [FATE and benchmark results](./results.md): the committed baseline, as a page.
- Each workflow run: the `fate`, `benchmark` and `baseline-check` step
  summaries, and the `fate-results-*` and `bench-results` artifacts.
- Nightly runs use the full subset. Pull request runs use the fast subset,
  which needs no FATE samples mirror access but still fetches FFmpeg's test
  definitions from GitHub.
