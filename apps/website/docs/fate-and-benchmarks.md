# FATE and benchmarks

The `fate` and `benchmark` jobs in the CI workflow
(`.github/workflows/CI.yml`) measure the st and mt cores against FFmpeg's
own test suite (FATE) and against native FFmpeg, so compatibility and
performance are tracked over time instead of assumed. The idea and the
pass/fail/skip and wasm/native ratio framing come from
[wasmpeg](https://github.com/wasmpeg/wasmpeg)'s `COMPAT.md` and
`CORRECTNESS.md` (LGPL-2.1-or-later).

These jobs are **not required checks**. The subset it covers is still
small, so a low pass rate or a slow run does not block a pull request; treat
its output as a signal to grow the subset and fix real gaps, not as a gate.

## What it measures

### Compatibility (FATE)

FFmpeg ships its own test definitions and reference output under
`tests/fate/*.mak` and `tests/ref/fate/` in its source tree. Each test names
an ffmpeg command line and, for the tests this workflow covers, a reference
`framecrc` or `framemd5` checksum file.

`scripts/fate/` reads those definitions for the FFmpeg tag pinned in the
Dockerfile (`FFMPEG_VERSION_ST` / `FFMPEG_VERSION_MT`), picks a subset from
`scripts/fate/config.mjs`'s allowlist of `.mak` files (common demuxers,
decoders and filters), runs the equivalent command inside the built core
under Node, and diffs the result against the reference file. This is a
small, from-scratch reader of that convention, not a port of FFmpeg's
`tests/fate-run.sh`.

Two subsets exist:

- **fast**: synthetic tests only (`lavfi` sources, no external samples), run
  on every pull request.
- **full**: adds sample-backed tests, fetched over rsync from the FATE
  samples mirror (`fate-suite.ffmpeg.org`), limited to exactly the samples
  the selected tests reference. Runs nightly and on manual dispatch.

Results are recorded per core as pass/fail/skip counts and a per-test list,
written as JSON and uploaded as workflow artifacts (`fate-results-st`,
`fate-results-mt`), and summarized as a markdown table in the workflow's
step summary.

This subset is not the actual FATE pass rate FFmpeg reports upstream: it
only exercises the `.mak` files listed in `scripts/fate/config.mjs`, and only
the `framecrc`/`framemd5` test shape. No pass rate is hardcoded here; see the
workflow's own results for current numbers.

### Performance (benchmarks)

`scripts/bench/run.mjs` runs a fixed, small set of transcodes on native
FFmpeg and on each core, on the same GitHub Actions runner, using the same
1-second H.264 sample the browser and Node tests already embed
(`tests/test-helper-browser.js`). That sample is video-only, so the fixed set
is:

- H.264 to VP9 (`libvpx-vp9`)
- H.264 to MPEG-4 (container remux to a different codec)
- a `scale` filter pass

Each case records wall time (`process.hrtime`) and peak RSS, averaged over a
few runs. `scripts/bench/report.mjs` combines the native and core results
into one report with a wasm/native time ratio per case, written as JSON
(`bench-report.json`) and as a markdown table in the step summary.

Native FFmpeg here is whatever `apt-get install ffmpeg` resolves to on the
`ubuntu-latest` runner image, not a build of the exact pinned FFmpeg tag;
the workflow records `ffmpeg -version` in its log so the actual native
version used is visible. This keeps the benchmark simple and reproducible
per runner image; pinning a static build of the exact tag is a reasonable
follow-up.

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
node scripts/fate/run.mjs --core packages/core --manifest manifest.json --out results.json

# Benchmarks: native, then each core, then combine.
node scripts/bench/run.mjs --native --out bench-native.json
node scripts/bench/run.mjs --core packages/core --label st --out bench-st.json
node scripts/bench/report.mjs --native bench-native.json --core bench-st.json --out bench-report.json --markdown-out bench-report.md
```

## Where the results are

- Each workflow run: the `fate` and `benchmark` jobs' step summaries, and
  the `fate-results-*` / `bench-results` artifacts.
- Nightly runs use the full subset; pull request runs use the fast,
  network-free subset.
