#!/usr/bin/env node
// Renders one or more scripts/fate/run.mjs result JSONs as a markdown
// summary, for $GITHUB_STEP_SUMMARY.
//
// Usage: node scripts/fate/summary.mjs results-st.json results-mt.json
import { readFileSync } from "node:fs";

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    throw new Error("usage: summary.mjs <results.json> [more.json ...]");
  }

  const lines = ["## FATE results", "", "| core | tag | subset | pass | fail | skip | total |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const path of paths) {
    const report = JSON.parse(readFileSync(path, "utf8"));
    const { pass, fail, skip, total } = report.summary;
    lines.push(`| ${report.core} | ${report.tag} | ${report.subset} | ${pass} | ${fail} | ${skip} | ${total} |`);
  }

  for (const path of paths) {
    const report = JSON.parse(readFileSync(path, "utf8"));
    const failed = report.tests.filter((t) => t.status === "fail");
    if (failed.length === 0) continue;
    lines.push("", `### ${report.core} failures`, "");
    for (const t of failed.slice(0, 50)) {
      lines.push(`- \`fate-${t.name}\`: ${t.reason}${t.diff ? ` (${t.diff})` : ""}`);
    }
    if (failed.length > 50) lines.push(`- ... and ${failed.length - 50} more`);
  }

  console.log(lines.join("\n"));
}

main();
