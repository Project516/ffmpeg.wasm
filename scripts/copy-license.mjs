#!/usr/bin/env node
// Copies the repo-root LICENSE and NOTICE into a package directory before
// packing, so `npm publish`/`npm pack` ships both in the tarball even though
// each package's `files` array otherwise only lists its own dist output. Run
// as a package's "prepack" script: `node ../../scripts/copy-license.mjs`.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptsDir, "..");
const targetDir = process.cwd();

for (const name of ["LICENSE", "NOTICE"]) {
  copyFileSync(path.join(repoRoot, name), path.join(targetDir, name));
}
