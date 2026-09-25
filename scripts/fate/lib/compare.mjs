// Compares a core's framecrc/framemd5 output against a FATE reference file.
//
// Reference files can carry a header comment line naming the encoder/decoder
// build (e.g. libavutil version stamps), which differs between the wasm
// build and whatever produced the checked-in reference. Lines starting with
// "#" are dropped from both sides before comparing so those stamps do not
// cause false failures; the frame-by-frame checksum lines are compared
// as-is.

function normalize(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * @returns {{ok: boolean, diff?: string}}
 */
export function compareOutput(actual, expected) {
  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e) return { ok: true };

  const aLines = a.split("\n");
  const eLines = e.split("\n");
  const firstDiff = aLines.findIndex((line, i) => line !== eLines[i]);
  const line = firstDiff === -1 ? Math.max(aLines.length, eLines.length) - 1 : firstDiff;
  return {
    ok: false,
    diff: `line ${line + 1}: expected ${JSON.stringify(eLines[line] ?? "<missing>")}, got ${JSON.stringify(aLines[line] ?? "<missing>")}`,
  };
}
