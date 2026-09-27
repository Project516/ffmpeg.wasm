// Builds and runs FFmpeg's own tests/audiogen.c and tests/videogen.c host
// tools to produce the synthetic inputs FATE's filter-audio.mak/
// filter-video.mak tests expect at tests/data/asynth-*.wav and friends (see
// mak.mjs's generatorFor for the paths this runner recognizes).
//
// This mirrors tests/Makefile's own build-and-run rules for those tools
// (e.g. `tests/data/asynth-%.wav: tests/audiogen | tests/data`), since this
// runner drives FATE without `make`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL_SOURCE = {
  audiogen: "audiogen.c",
  videogen: "videogen.c",
};

/**
 * Compiles and runs the audiogen/videogen tools the given specs need, and
 * returns their output bytes keyed by build-relative path.
 *
 * @param {string} srcDir a tag's checked-out tests/ directory (holds
 *   audiogen.c/videogen.c)
 * @param {{tool: "audiogen"|"videogen", path: string, args: string[]}[]} specs
 * @returns {Map<string, Buffer>}
 * @throws if the host `cc` toolchain or a generator invocation fails; the
 *   caller decides whether that means skipping the tests that needed it.
 */
export function generateInputs(srcDir, specs) {
  const tools = [...new Set(specs.map((s) => s.tool))];
  if (tools.length === 0) return new Map();

  const workDir = mkdtempSync(join(tmpdir(), "fate-gen-"));
  try {
    const binaries = new Map();
    for (const tool of tools) {
      const bin = join(workDir, tool);
      execFileSync("cc", ["-O2", "-o", bin, join(srcDir, TOOL_SOURCE[tool]), "-lm"], { stdio: "pipe" });
      binaries.set(tool, bin);
    }

    const outputs = new Map();
    for (const spec of specs) {
      if (outputs.has(spec.path)) continue;
      const outPath = join(workDir, spec.path.replaceAll("/", "_"));
      execFileSync(binaries.get(spec.tool), [outPath, ...spec.args], { stdio: "pipe" });
      outputs.set(spec.path, readFileSync(outPath));
    }
    return outputs;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
