// Extracts FATE test definitions from FFmpeg's tests/fate/*.mak files.
//
// FATE targets follow a fixed shape in the real Makefiles:
//   fate-<name>: CMD = framecrc -i $(TARGET_SAMPLES)/<dir>/<file> [args...]
// with backslash line continuations for long argument lists. This parser
// only understands the framecrc/framemd5 forms (the ones this first subset
// runs); anything else is left out rather than guessed at.
//
// This is a small, from-scratch reader of that convention, not a port of
// FFmpeg's tests/fate-run.sh. run.mjs reimplements just enough of
// fate-run.sh's framecrc/framemd5 behavior to compare output against the
// same tests/ref/fate/<name> reference files.

const CMD_RE = /^fate-([A-Za-z0-9][\w.+-]*)\s*:\s*CMD\s*=\s*(framecrc|framemd5)\s+(.*)$/;

function joinContinuations(text) {
  return text.replace(/\\\r?\n[ \t]*/g, " ");
}

/**
 * @param {string} text contents of one .mak file
 * @returns {{name: string, mode: "framecrc"|"framemd5", args: string}[]}
 */
export function parseMakFile(text) {
  const joined = joinContinuations(text);
  const tests = [];
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = CMD_RE.exec(line);
    if (!match) continue;
    const [, name, mode, args] = match;
    tests.push({ name, mode, args: args.trim() });
  }
  return tests;
}

const SAMPLE_TOKEN_RE = /\$\(TARGET_SAMPLES\)\/([^\s'"]+)/g;
const UNSUPPORTED_TOKEN_RE = /\$\((TARGET_PATH|SRC_PATH)\)/;

/**
 * Classifies a parsed test as synthetic (self-contained, e.g. lavfi
 * sources), sample-backed (needs files rsynced from the FATE samples
 * mirror), or unsupported (references the FFmpeg source tree itself, or
 * other constructs this runner does not resolve).
 */
export function classifyTest(test) {
  if (UNSUPPORTED_TOKEN_RE.test(test.args)) {
    return { kind: "unsupported", samples: [] };
  }
  const samples = [...test.args.matchAll(SAMPLE_TOKEN_RE)].map((m) => m[1]);
  return { kind: samples.length > 0 ? "sample" : "synthetic", samples };
}
