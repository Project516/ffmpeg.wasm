// Smoke test for the opt-in JSPI core (packages/core-jspi): exec() and
// ffprobe() return Promises. Needs a Node.js with JSPI (V8 13.7+, or
// --experimental-wasm-jspi before that). Run:
//   node tests/ffmpeg-core-jspi.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const createFFmpegCore = require("../packages/core-jspi/dist/umd/ffmpeg-core.js");
const { VIDEO_1S_MP4, b64ToUint8Array } = require("./test-helper-browser.js");

describe("[ffmpeg-core][jspi]", () => {
  let core;

  before(async () => {
    core = await createFFmpegCore();
    core.FS.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
  });

  it("returns a Promise from exec()", async () => {
    const run = core.exec("-h");
    assert.ok(run instanceof Promise);
    assert.equal(await run, 0);
  });

  it("transcodes, twice", async () => {
    for (let i = 0; i < 2; i++) {
      assert.equal(await core.exec("-i", "video.mp4", "video.avi"), 0);
      assert.notEqual(core.FS.readFile("video.avi").length, 0);
      core.FS.unlink("video.avi");
    }
  });

  it("fails on a missing input, then still transcodes", async () => {
    assert.notEqual(await core.exec("-i", "missing.mp4", "out.avi"), 0);
    assert.equal(await core.exec("-i", "video.mp4", "video.avi"), 0);
    core.FS.unlink("video.avi");
  });

  it("probes", async () => {
    let out = "";
    core.setLogger(({ message }) => (out += message));
    assert.equal(
      await core.ffprobe("-v", "error", "-show_entries", "format=duration", "video.mp4"),
      0
    );
    assert.match(out, /duration=/);
  });

  it("refuses a second command while one runs", async () => {
    const run = core.exec("-i", "video.mp4", "video.avi");
    assert.throws(() => core.exec("-h"), /one command at a time/);
    assert.equal(await run, 0);
  });
});
