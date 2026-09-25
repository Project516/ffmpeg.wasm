#!/usr/bin/env node
// Writes a minimal package.json into a dist subdirectory so Node picks the
// right module system for that subtree regardless of the package's own
// top-level "type". Needed because a package can ship both a CommonJS and
// an ES module build side by side (see packages/util and packages/ffmpeg).
// Usage: node scripts/emit-dist-package-json.mjs <dir> <commonjs|module>
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , dir, type] = process.argv;

if (!dir || (type !== "commonjs" && type !== "module")) {
  console.error(
    "Usage: node scripts/emit-dist-package-json.mjs <dir> <commonjs|module>",
  );
  process.exit(1);
}

writeFileSync(join(dir, "package.json"), JSON.stringify({ type }) + "\n");
