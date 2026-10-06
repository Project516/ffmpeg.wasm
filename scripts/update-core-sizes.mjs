#!/usr/bin/env node
// Rewrites apps/website/src/data/core-sizes.json with the byte sizes of
// ffmpeg-core.js and ffmpeg-core.wasm (dist/umd) for one version.
//
// Usage: node scripts/update-core-sizes.mjs <version> [--local]
// Default reads the published packages from the jsDelivr data API. --local
// reads packages/core*/dist/umd instead, for a release PR whose version is
// not published yet (download the CI build artifacts into those folders).
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(repoRoot, "apps/website/src/data/core-sizes.json");
const FILES = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

const [version, flag] = process.argv.slice(2);
if (!version || (flag && flag !== "--local")) {
  console.error("usage: update-core-sizes.mjs <version> [--local]");
  process.exit(1);
}

async function sizesFor(pkg) {
  if (flag === "--local") {
    const dir = join(repoRoot, "packages", pkg, "dist/umd");
    return Object.fromEntries(FILES.map((f) => [f, statSync(join(dir, f)).size]));
  }
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
for (const pkg of ["core", "core-mt"]) sizes[pkg] = await sizesFor(pkg);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(sizes, null, 2) + "\n");
console.log(`wrote ${outPath}`);
