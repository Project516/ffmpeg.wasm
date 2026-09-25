// Extracts FATE test definitions from FFmpeg's tests/fate/*.mak files.
//
// FATE targets follow a fixed shape in the real Makefiles:
//   fate-<name>: CMD = framecrc -i $(TARGET_SAMPLES)/<dir>/<file> [args...]
// with backslash line continuations for long argument lists, and the input
// path is often indirected through a per-target variable instead of being
// inlined in CMD, e.g.:
//   fate-filter-adelay: SRC = $(TARGET_PATH)/tests/data/asynth-44100-2.wav
//   fate-filter-adelay: CMD = framecrc -i $(SRC) -af ...
// This parser only understands the framecrc/framemd5 forms (the ones this
// first subset runs); anything else is left out rather than guessed at.
//
// This is a small, from-scratch reader of that convention, not a port of
// FFmpeg's tests/fate-run.sh. run.mjs reimplements just enough of
// fate-run.sh's framecrc/framemd5 behavior to compare output against the
// same tests/ref/fate/<name> reference files.

const CMD_RE = /^fate-([A-Za-z0-9][\w.+-]*)\s*:\s*CMD\s*=\s*(framecrc|framemd5)\s+(.*)$/;
const VAR_RE = /^fate-([A-Za-z0-9][\w.+-]*)\s*:\s*(?!CMD\s*=)([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

function joinContinuations(text) {
  return text.replace(/\\\r?\n[ \t]*/g, " ");
}

/**
 * @param {string} text contents of one .mak file
 * @returns {{name: string, mode: "framecrc"|"framemd5", args: string, vars: Record<string,string>}[]}
 */
export function parseMakFile(text) {
  const joined = joinContinuations(text);
  const lines = joined.split(/\r?\n/).map((l) => l.trim());

  const varsByName = {};
  for (const line of lines) {
    const match = VAR_RE.exec(line);
    if (!match) continue;
    const [, name, varName, value] = match;
    (varsByName[name] ??= {})[varName] = value.trim();
  }

  const tests = [];
  for (const line of lines) {
    const match = CMD_RE.exec(line);
    if (!match) continue;
    const [, name, mode, args] = match;
    tests.push({ name, mode, args: args.trim(), vars: varsByName[name] ?? {} });
  }
  return tests;
}

const ANY_TOKEN_RE = /\$\([A-Z][A-Z0-9_]*\)/;
const SAMPLE_PATH_RE = /^\$\(TARGET_SAMPLES\)\/(.+)$/;
const BUILD_PATH_RE = /^\$\(TARGET_PATH\)\/(.+)$/;

// Build-relative paths this runner knows how to produce, mirroring the
// generator rules in FFmpeg's tests/Makefile: tests/audiogen.c and
// tests/videogen.c, run on the host and written into the core's MEMFS.
// Anything else under $(TARGET_PATH) (copied fixtures, multi-frame image2
// sequences, ...) is left unsupported rather than guessed at.
const ASYNTH_RE = /^tests\/data\/asynth-([\d]+(?:-[\d]+){0,2})\.wav$/;
const VSYNTH_YUV_RE = /^tests\/data\/(vsynth[13])\.yuv$/;

/**
 * @param {string} buildPath a path relative to the FATE build root, e.g.
 *   "tests/data/asynth-44100-2.wav"
 * @returns {{tool: "audiogen"|"videogen", path: string, args: string[]}|null}
 */
function generatorFor(buildPath) {
  const asynth = ASYNTH_RE.exec(buildPath);
  if (asynth) {
    return { tool: "audiogen", path: buildPath, args: asynth[1].split("-") };
  }
  if (buildPath === "tests/data/asynth1.sw") {
    return { tool: "audiogen", path: buildPath, args: [] };
  }
  const vsynth = VSYNTH_YUV_RE.exec(buildPath);
  if (vsynth) {
    // vsynth3 is generated at the FATE default frame size (FATEW x FATEH =
    // 34x34); vsynth1 uses videogen's own default size.
    return { tool: "videogen", path: buildPath, args: vsynth[1] === "vsynth3" ? ["34", "34"] : [] };
  }
  return null;
}

/**
 * Resolves $(VAR) references in `text` against a test's own per-target
 * variables (SRC, SRC2, ...). Leaves $(TARGET_PATH)/$(TARGET_SAMPLES) and any
 * unknown token alone; those are resolved by classifyTest/run.mjs.
 */
export function resolveVars(text, vars) {
  return text.replace(/\$\(([A-Z][A-Z0-9_]*)\)/g, (token, name) => (name in vars ? vars[name] : token));
}

/**
 * Classifies a parsed test as synthetic (self-contained: lavfi sources, or
 * inputs this runner can generate with audiogen/videogen), sample-backed
 * (needs files rsynced from the FATE samples mirror), or unsupported
 * (references a fixture this runner cannot produce or resolve).
 */
export function classifyTest(test) {
  const resolved = resolveVars(test.args, test.vars);

  const samples = [];
  const generate = [];
  let unsupported = false;

  for (const match of resolved.matchAll(/\$\(TARGET_SAMPLES\)\/[^\s'"]+|\$\(TARGET_PATH\)\/[^\s'"]+/g)) {
    const token = match[0];
    const sampleMatch = SAMPLE_PATH_RE.exec(token);
    if (sampleMatch) {
      samples.push(sampleMatch[1]);
      continue;
    }
    const buildMatch = BUILD_PATH_RE.exec(token);
    if (buildMatch) {
      const buildPath = buildMatch[1];
      const gen = generatorFor(buildPath);
      if (gen) generate.push(gen);
      else unsupported = true;
    }
  }

  // Any $(VAR) left over after resolving this test's own variables is a
  // reference this runner does not know how to satisfy (e.g. $(SRC_PATH),
  // pointing at the FFmpeg source tree itself).
  if (!unsupported && ANY_TOKEN_RE.test(resolved.replace(/\$\(TARGET_PATH\)|\$\(TARGET_SAMPLES\)/g, ""))) {
    unsupported = true;
  }

  if (unsupported) return { kind: "unsupported", samples: [], generate: [] };
  if (samples.length > 0) return { kind: "sample", samples, generate };
  return { kind: "synthetic", samples: [], generate };
}
