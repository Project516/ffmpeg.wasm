// Compares FATE and benchmark results with the committed baseline in
// baseline/. Pure functions; check.mjs is the CLI.

// A benchmark metric this much above its baseline is a warning, and this
// much above is a failure. Wall times on a shared runner are noisy, and the
// native ffmpeg run that the ratio divides by is only about 100 ms, so the
// failure threshold is deliberately wide.
export const BENCH_WARN = 0.2;
export const BENCH_FAIL = 0.5;

/**
 * @param {object} baselineCore baseline.fate[core][subset]: { makFile: { pass: string[], fail: {}, skip: {} } }
 * @param {object} report one scripts/fate/run.mjs result
 */
export function compareFate(baselineCore, report) {
  const baseline = new Map();
  for (const group of Object.values(baselineCore ?? {})) {
    for (const name of group.pass) baseline.set(name, "pass");
    for (const name of Object.keys(group.fail ?? {})) baseline.set(name, "fail");
    for (const name of Object.keys(group.skip ?? {})) baseline.set(name, "skip");
  }

  const current = new Map(report.tests.map((t) => [t.name, t]));
  const regressions = [];
  const warnings = [];
  for (const [name, status] of baseline) {
    if (status !== "pass") continue;
    const now = current.get(name);
    if (!now) warnings.push(`fate-${name}: passed in the baseline, not run now`);
    else if (now.status === "fail") regressions.push(`fate-${name}: passed in the baseline, now fails: ${now.reason}`);
    else if (now.status === "skip") warnings.push(`fate-${name}: passed in the baseline, now skipped: ${now.reason}`);
  }

  const fixed = report.tests.filter((t) => t.status === "pass" && baseline.has(t.name) && baseline.get(t.name) !== "pass");
  const added = report.tests.filter((t) => !baseline.has(t.name));
  return { regressions, warnings, fixed: fixed.map((t) => t.name), added: added.map((t) => t.name) };
}

/**
 * Compares each core's wasm/native wall-time ratio and peak RSS with the
 * baseline. The ratio, not raw milliseconds, so a faster or slower runner
 * moves both sides of it.
 * @param {object} baselineBench baseline.bench: { cores: { st: { case: { ratio, peakRssKb } } } }
 * @param {object} report scripts/bench/report.mjs output
 */
export function compareBench(baselineBench, report) {
  const failures = [];
  const warnings = [];
  const rows = [];
  for (const core of report.cores) {
    for (const caseName of report.caseNames) {
      const nativeMs = report.native.cases.find((c) => c.name === caseName)?.medianWallMs;
      const c = core.cases.find((x) => x.name === caseName);
      const base = baselineBench?.cores?.[core.label]?.[caseName];
      const where = `${core.label} ${caseName}`;
      if (c?.medianWallMs == null || nativeMs == null) {
        failures.push(`${where}: no successful runs`);
        continue;
      }
      const ratio = c.medianWallMs / nativeMs;
      const rss = c.medianPeakRssKb;
      if (!base) {
        warnings.push(`${where}: not in the baseline`);
        rows.push({ where, ratio, rss });
        continue;
      }
      const ratioDelta = ratio / base.ratio - 1;
      const rssDelta = rss != null && base.peakRssKb ? rss / base.peakRssKb - 1 : 0;
      rows.push({ where, ratio, rss, baseRatio: base.ratio, baseRss: base.peakRssKb, ratioDelta, rssDelta });
      for (const [what, delta] of [["time ratio", ratioDelta], ["peak memory", rssDelta]]) {
        const msg = `${where}: ${what} is ${(delta * 100).toFixed(0)}% above the baseline`;
        if (delta > BENCH_FAIL) failures.push(msg);
        else if (delta > BENCH_WARN) warnings.push(msg);
      }
    }
  }
  return { failures, warnings, rows };
}

/** Converts a bench-report.json into the shape stored in baseline/bench.json. */
export function benchBaselineFrom(report) {
  const cores = {};
  for (const core of report.cores) {
    cores[core.label] = {};
    for (const caseName of report.caseNames) {
      const nativeMs = report.native.cases.find((c) => c.name === caseName)?.medianWallMs;
      const c = core.cases.find((x) => x.name === caseName);
      if (c?.medianWallMs == null || nativeMs == null) throw new Error(`${core.label} ${caseName} has no successful runs`);
      cores[core.label][caseName] = {
        nativeMs: Math.round(nativeMs),
        wasmMs: Math.round(c.medianWallMs),
        ratio: Number((c.medianWallMs / nativeMs).toFixed(2)),
        peakRssKb: Math.round(c.medianPeakRssKb),
      };
    }
  }
  return { native: report.native.version ?? "native ffmpeg", cores };
}

/** Converts a run.mjs result into the grouped shape stored in baseline/fate.json. */
export function fateBaselineFrom(report) {
  const groups = {};
  for (const t of report.tests) {
    const g = (groups[t.makFile] ??= { pass: [], fail: {}, skip: {} });
    if (t.status === "pass") g.pass.push(t.name);
    else g[t.status][t.name] = t.reason ?? "";
  }
  for (const g of Object.values(groups)) {
    if (Object.keys(g.fail).length === 0) delete g.fail;
    if (Object.keys(g.skip).length === 0) delete g.skip;
  }
  return groups;
}
