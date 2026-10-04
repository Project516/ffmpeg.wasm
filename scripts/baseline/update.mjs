#!/usr/bin/env node
// Rewrites baseline/fate.json, baseline/bench.json and the generated results
// page from CI artifacts. Each argument is a workflow run id (downloaded with
// gh) or a directory that already holds fate-results-*.json and
// bench-report.json files. Pass one fast-subset run and one full-subset run
// to refresh both FATE baselines. Commit the result in a pull request.
//
// Usage: node scripts/baseline/update.mjs <run-id|dir> [<run-id|dir> ...]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchBaselineFrom, fateBaselineFrom } from "./compare.mjs";
import { writePage } from "./docs.mjs";

const baselineDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "baseline");

function jsonFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => join(e.parentPath, e.name));
}

function readBaseline(name) {
  const path = join(baselineDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function write(name, data) {
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(join(baselineDir, name), JSON.stringify(data, null, 2) + "\n");
}

function main() {
  const sources = process.argv.slice(2);
  if (sources.length === 0) throw new Error("usage: update.mjs <run-id|dir> [<run-id|dir> ...]");

  const scratch = mkdtempSync(join(tmpdir(), "baseline-"));
  try {
    const dirs = sources.map((source) => {
      if (!/^\d+$/.test(source)) return source;
      const dir = join(scratch, source);
      execFileSync("gh", ["run", "download", source, "--pattern", "fate-results-*", "--pattern", "bench-results", "-D", dir], { stdio: "inherit" });
      return dir;
    });

    const files = dirs.flatMap(jsonFiles);
    const fateReports = files.filter((f) => /fate-results-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(f, "utf8")));
    const benchFile = files.filter((f) => f.endsWith("bench-report.json")).at(-1);

    if (fateReports.length > 0) {
      let fate = readBaseline("fate.json");
      const tag = fateReports[0].tag;
      if (!fate || fate.tag !== tag) fate = { tag, cores: {} };
      for (const report of fateReports) {
        if (report.tag !== tag) throw new Error(`mixed FFmpeg tags: ${tag} and ${report.tag}`);
        (fate.cores[report.core] ??= {})[report.subset] = fateBaselineFrom(report);
        console.log(`fate ${report.core} ${report.subset}: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skip} skip`);
      }
      write("fate.json", fate);
    }
    if (benchFile) {
      write("bench.json", benchBaselineFrom(JSON.parse(readFileSync(benchFile, "utf8"))));
      console.log(`bench baseline from ${benchFile}`);
    }
    if (fateReports.length === 0 && !benchFile) throw new Error("no fate-results-*.json or bench-report.json found");
    writePage();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
