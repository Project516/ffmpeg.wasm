#!/usr/bin/env node
// Generates apps/website/docs/results.md from baseline/fate.json and
// baseline/bench.json. With --check, exits 1 if the committed page is stale.
//
// Usage: node scripts/baseline/docs.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pagePath = join(root, "apps", "website", "docs", "results.md");
const CORES = ["st", "mt"];
const SUBSETS = ["full", "fast"];

function counts(groups) {
  const c = { pass: 0, fail: 0, skip: 0 };
  for (const g of Object.values(groups)) {
    c.pass += g.pass.length;
    c.fail += Object.keys(g.fail ?? {}).length;
    c.skip += Object.keys(g.skip ?? {}).length;
  }
  return c;
}

function rate(c) {
  return c.pass + c.fail === 0 ? "-" : `${((c.pass / (c.pass + c.fail)) * 100).toFixed(1)}%`;
}

function fateSection(fate) {
  const lines = ["## Compatibility (FATE)", ""];
  lines.push(
    `FFmpeg ${fate.tag}. The pass rate is pass divided by pass plus fail. A skipped test is one the runner could not run: its sample is missing from the FATE mirror, or it is a known failure listed below.`,
    "",
  );
  for (const subset of SUBSETS) {
    const perCore = CORES.filter((core) => fate.cores[core]?.[subset]);
    if (perCore.length === 0) continue;
    lines.push(`### ${subset === "full" ? "Full subset (nightly)" : "Fast subset (every pull request)"}`, "");
    lines.push("| core | pass | fail | skip | total | pass rate |", "| --- | --- | --- | --- | --- | --- |");
    for (const core of perCore) {
      const c = counts(fate.cores[core][subset]);
      lines.push(`| ${core} | ${c.pass} | ${c.fail} | ${c.skip} | ${c.pass + c.fail + c.skip} | ${rate(c)} |`);
    }
    lines.push("");

    const groups = [...new Set(perCore.flatMap((core) => Object.keys(fate.cores[core][subset])))];
    lines.push(`| test file | ${perCore.map((c) => `${c} pass / total`).join(" | ")} |`, `| --- | ${perCore.map(() => "---").join(" | ")} |`);
    for (const group of groups) {
      const cells = perCore.map((core) => {
        const g = fate.cores[core][subset][group];
        if (!g) return "-";
        const total = g.pass.length + Object.keys(g.fail ?? {}).length + Object.keys(g.skip ?? {}).length;
        return `${g.pass.length} / ${total}`;
      });
      lines.push(`| \`${group}\` | ${cells.join(" | ")} |`);
    }
    lines.push("");

    for (const core of perCore) {
      const rows = [];
      for (const g of Object.values(fate.cores[core][subset])) {
        for (const [name, reason] of Object.entries(g.fail ?? {})) rows.push(`- \`fate-${name}\` fails: ${reason}`);
        for (const [name, reason] of Object.entries(g.skip ?? {})) rows.push(`- \`fate-${name}\` skipped: ${reason}`);
      }
      if (rows.length === 0) continue;
      lines.push(`#### ${core} core, ${subset} subset, failing and skipped tests`, "", ...rows.map((r) => r.replace(/[{}<>]/g, " ")), "");
    }
  }
  return lines;
}

function benchSection(bench) {
  const cores = CORES.filter((c) => bench.cores[c]);
  const cases = Object.keys(bench.cores[cores[0]]);
  const lines = ["## Performance", ""];
  lines.push(
    `Median of five runs on one GitHub Actions runner, against ${bench.native.replace(/[{}<>]/g, " ")}. Each case transcodes a 1 second H.264 clip, so startup is a large part of the native time.`,
    "",
  );
  lines.push(`| case | native (ms) | ${cores.map((c) => `${c} (ms) | ${c} ratio | ${c} peak RSS (MB)`).join(" | ")} |`);
  lines.push(`| --- | --- | ${cores.map(() => "--- | --- | ---").join(" | ")} |`);
  for (const name of cases) {
    const native = bench.cores[cores[0]][name].nativeMs;
    const cells = cores.map((c) => {
      const r = bench.cores[c][name];
      return `${r.wasmMs} | ${r.ratio.toFixed(2)}x | ${(r.peakRssKb / 1024).toFixed(0)}`;
    });
    lines.push(`| ${name} | ${native} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines;
}

export function renderPage(fate, bench) {
  const lines = [
    "# FATE and benchmark results",
    "",
    "This page is generated from `baseline/fate.json` and `baseline/bench.json` by `node scripts/baseline/docs.mjs`. Do not edit it by hand. [FATE and benchmarks](./fate-and-benchmarks.md) explains how the numbers are produced and how to update them.",
    "",
  ];
  if (fate) lines.push(...fateSection(fate));
  if (bench) lines.push(...benchSection(bench));
  return lines.join("\n").replace(/\n+$/, "\n");
}

function readBaseline(name) {
  const path = join(root, "baseline", name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function writePage() {
  writeFileSync(pagePath, renderPage(readBaseline("fate.json"), readBaseline("bench.json")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expected = renderPage(readBaseline("fate.json"), readBaseline("bench.json"));
  if (process.argv.includes("--check")) {
    if (!existsSync(pagePath) || readFileSync(pagePath, "utf8") !== expected) {
      console.error("apps/website/docs/results.md is stale. Run `node scripts/baseline/docs.mjs` and commit it.");
      process.exit(1);
    }
    console.log("results.md matches the baseline");
  } else {
    writeFileSync(pagePath, expected);
    console.log(`wrote ${pagePath}`);
  }
}
