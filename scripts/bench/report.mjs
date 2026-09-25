#!/usr/bin/env node
// Combines one native benchmark JSON and one or more core benchmark JSONs
// (from scripts/bench/run.mjs) into a single report with wasm/native ratios,
// and writes a markdown table alongside it.
//
// Usage: node scripts/bench/report.mjs --native bench-native.json --core bench-st.json --core bench-mt.json --out bench-report.json
import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = { native: null, cores: [], out: null, markdownOut: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--native") args.native = argv[++i];
    else if (argv[i] === "--core") args.cores.push(argv[++i]);
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--markdown-out") args.markdownOut = argv[++i];
  }
  if (!args.native || args.cores.length === 0 || !args.out) {
    throw new Error("usage: report.mjs --native <file.json> --core <file.json> [--core <file.json> ...] --out <file.json> [--markdown-out <file.md>]");
  }
  return args;
}

function toMarkdown(report) {
  const lines = ["| case | native (ms) |" + report.cores.map((c) => ` ${c.label} (ms) | ${c.label} ratio |`).join("")];
  lines.push("| --- | --- |" + report.cores.map(() => " --- | --- |").join(""));
  for (const caseName of report.caseNames) {
    const nativeMs = report.native.cases.find((c) => c.name === caseName)?.avgWallMs;
    const row = [`| ${caseName} | ${nativeMs?.toFixed(1) ?? "?"} |`];
    for (const core of report.cores) {
      const c = core.cases.find((c) => c.name === caseName);
      const ratio = c?.avgWallMs != null && nativeMs != null ? (c.avgWallMs / nativeMs).toFixed(1) : "?";
      row.push(` ${c?.avgWallMs?.toFixed(1) ?? "?"} | ${ratio}x |`);
    }
    lines.push(row.join(""));
  }
  return lines.join("\n");
}

function main() {
  const { native: nativePath, cores: corePaths, out, markdownOut } = parseArgs(process.argv.slice(2));
  const native = JSON.parse(readFileSync(nativePath, "utf8"));
  const cores = corePaths.map((p) => JSON.parse(readFileSync(p, "utf8")));
  const caseNames = [...new Set(native.cases.map((c) => c.name))];

  const report = { generatedAt: new Date().toISOString(), caseNames, native, cores };
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);

  const markdown = toMarkdown(report);
  console.log(markdown);
  if (markdownOut) writeFileSync(markdownOut, markdown);
}

main();
