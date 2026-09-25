// Compares a core's framecrc/framemd5 output against a FATE reference file.
//
// framecrc/framemd5 headers (#tb, #media_type, #codec_id, #dimensions/
// #sample_rate, #channel_layout_name/#sar, and framemd5's #format/#version/
// #hash) describe the actual stream and are stable across builds, so they
// are compared like any other line: a wasm build reporting the wrong sample
// rate or dimensions should fail the test. Only a "#software:" line, which
// would carry a libavutil/libavcodec build stamp, is dropped; the muxers
// this runner uses do not currently emit one, but nothing here should start
// failing on it if a future FFmpeg release adds it.

function normalize(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#software:"))
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
