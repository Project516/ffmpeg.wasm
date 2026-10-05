#!/usr/bin/env node
// Compares FATE results and a benchmark report with the committed baseline in
// baseline/, prints a markdown summary, and exits 1 on a regression: a test
// that passed in the baseline and now fails, a missing result file, or a
// benchmark metric more than BENCH_FAIL above its baseline.
//
// Usage: node scripts/baseline/check.mjs --fate fate-results-st.json --fate fate-results-mt.json --bench bench-report.json
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCH_FAIL, BENCH_WARN, compareBench, compareFate } from "./compare.mjs";

const baselineDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "baseline");
const LIST_LIMIT = 15;

function parseArgs(argv) {
  const args = { fate: [], bench: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fate") args.fate.push(argv[++i]);
    else if (argv[i] === "--bench") args.bench = argv[++i];
  }
  if (args.fate.length === 0 && !args.bench) {
    throw new Error("usage: check.mjs [--fate <results.json> ...] [--bench <bench-report.json>]");
  }
  return args;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function list(lines) {
  const shown = lines.slice(0, LIST_LIMIT).map((l) => `- ${l}`);
  if (lines.length > LIST_LIMIT) shown.push(`- and ${lines.length - LIST_LIMIT} more`);
  return shown;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = ["## Baseline check", ""];
  let failed = false;

  const fateBaseline = readJson(join(baselineDir, "fate.json"));
  for (const path of args.fate) {
    const report = readJson(path);
    if (!report) {
      out.push(`**${path}**: no results file, the run did not finish.`, "");
      failed = true;
      continue;
    }
    const base = fateBaseline?.cores?.[report.core]?.[report.subset];
    const title = `FATE ${report.core}, ${report.subset} subset`;
    if (!base) {
      out.push(`### ${title}`, "", "No baseline for this core and subset. See \"Updating the baseline\" in the FATE and benchmarks docs.", "");
      continue;
    }
    const { regressions, warnings, fixed, added } = compareFate(base, report);
    const { pass, fail, skip, total } = report.summary;
    out.push(`### ${title}`, "", `${pass} pass, ${fail} fail, ${skip} skip of ${total}. ${regressions.length} regression(s).`, "");
    if (fateBaseline.tag !== report.tag) out.push(`The baseline is for ${fateBaseline.tag} and this run is ${report.tag}.`, "");
    if (regressions.length > 0) {
      failed = true;
      out.push("Regressions:", ...list(regressions), "");
      for (const r of regressions) console.error(`::error::${r}`);
    }
    if (warnings.length > 0) out.push("Not passing now, but not failing:", ...list(warnings), "");
    if (fixed.length > 0) out.push(`${fixed.length} test(s) that did not pass in the baseline pass now, so the baseline can be updated.`, "");
    if (added.length > 0) out.push(`${added.length} test(s) are not in the baseline yet.`, "");
  }

  if (args.bench) {
    const report = readJson(args.bench);
    if (!report) {
      out.push(`**${args.bench}**: no results file, the benchmark did not finish.`, "");
      failed = true;
    } else {
      const benchBaseline = readJson(join(baselineDir, "bench.json"));
      const { failures, warnings, rows } = compareBench(benchBaseline, report);
      out.push("### Benchmarks", "", `Warn above ${BENCH_WARN * 100}% over the baseline, fail above ${BENCH_FAIL * 100}%.`, "");
      out.push("| core and case | wasm/native | baseline | peak RSS (KB) | baseline |", "| --- | --- | --- | --- | --- |");
      for (const r of rows) {
        out.push(`| ${r.where} | ${r.ratio.toFixed(2)}x | ${r.baseRatio?.toFixed(2) ?? "-"}x | ${r.rss == null ? "-" : Math.round(r.rss)} | ${r.baseRss ?? "-"} |`);
      }
      out.push("");
      if (failures.length > 0) {
        failed = true;
        out.push("Failures:", ...list(failures), "");
        for (const f of failures) console.error(`::error::${f}`);
      }
      if (warnings.length > 0) {
        out.push("Warnings:", ...list(warnings), "");
        for (const w of warnings) console.error(`::warning::${w}`);
      }
    }
  }

  console.log(out.join("\n"));
  if (failed) process.exitCode = 1;
}

main();
