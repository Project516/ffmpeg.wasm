#!/usr/bin/env node
// Renders one or more scripts/fate/run.mjs result JSONs as a markdown
// summary, for $GITHUB_STEP_SUMMARY.
//
// Usage: node scripts/fate/summary.mjs results-st.json results-mt.json
import { existsSync, readFileSync } from "node:fs";

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    throw new Error("usage: summary.mjs <results.json> [more.json ...]");
  }

  // A matrix leg can fail before run.mjs ever writes its results file (e.g.
  // fetch-defs or the sample rsync step); report that leg as missing rather
  // than letting readFileSync throw and lose the other leg's results too.
  const reports = [];
  const lines = ["## FATE results", "", "| core | tag | subset | pass | fail | skip | total |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const path of paths) {
    if (!existsSync(path)) {
      lines.push(`| ${path} | - | - | - | - | - | no results |`);
      continue;
    }
    const report = JSON.parse(readFileSync(path, "utf8"));
    reports.push(report);
    const { pass, fail, skip, total } = report.summary;
    lines.push(`| ${report.core} | ${report.tag} | ${report.subset} | ${pass} | ${fail} | ${skip} | ${total} |`);
  }

  for (const report of reports) {
    const failed = report.tests.filter((t) => t.status === "fail");
    if (failed.length === 0) continue;
    lines.push("", `### ${report.core} failures`, "");
    for (const t of failed) {
      lines.push(`- \`fate-${t.name}\`: ${t.reason}${t.diff ? ` (${t.diff})` : ""}`);
    }
  }

  console.log(lines.join("\n"));
}

main();
