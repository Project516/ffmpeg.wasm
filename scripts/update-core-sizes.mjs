#!/usr/bin/env node
// Rewrites apps/website/src/data/core-sizes.json with the byte sizes of
// ffmpeg-core.js and ffmpeg-core.wasm (dist/umd) for one version.
//
// Usage: node scripts/update-core-sizes.mjs <version> [--run <run-id>]
// Default reads the published packages from the jsDelivr data API. --run
// reads the ffmpeg-core and ffmpeg-core-mt artifacts of a CI run with gh
// instead, for a release PR whose version is not published yet. The cores
// are built from the same inputs, so the sizes hold for the tag.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(repoRoot, "apps/website/src/data/core-sizes.json");
const FILES = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

const [version, flag, runId] = process.argv.slice(2);
if (!version || (flag && (flag !== "--run" || !runId))) {
  console.error("usage: update-core-sizes.mjs <version> [--run <run-id>]");
  process.exit(1);
}

function sizesFromRun(pkg, scratch) {
  const dir = join(scratch, pkg);
  execFileSync("gh", ["run", "download", runId, "-n", `ffmpeg-${pkg}`, "-D", dir], {
    stdio: "inherit",
  });
  return Object.fromEntries(FILES.map((f) => [f, statSync(join(dir, "umd", f)).size]));
}

async function sizesFromJsdelivr(pkg) {
  const url = `https://data.jsdelivr.com/v1/packages/npm/@project516/ffmpeg-wasm-${pkg}@${version}?structure=flat`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const { files } = await res.json();
  return Object.fromEntries(
    FILES.map((f) => {
      const file = files.find((x) => x.name === `/dist/umd/${f}`);
      if (!file) throw new Error(`${pkg}@${version}: /dist/umd/${f} not found`);
      return [f, file.size];
    })
  );
}

const sizes = { version };
const scratch = mkdtempSync(join(tmpdir(), "core-sizes-"));
try {
  for (const pkg of ["core", "core-mt"]) {
    sizes[pkg] = flag ? sizesFromRun(pkg, scratch) : await sizesFromJsdelivr(pkg);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(sizes, null, 2) + "\n");
console.log(`wrote ${outPath}`);
