// Node.js tests for the @project516/ffmpeg wrapper: load, exec, ffprobe,
// the filesystem calls, timeout and terminate, run against both the st and
// the mt core. Select the core with FFMPEG_TYPE=st|mt (defaults to st); see
// the test:node:ffmpeg:* scripts in the root package.json.
import { createRequire } from "node:module";
import { expect } from "chai";
import { FFmpeg } from "@project516/ffmpeg";
import { fetchFile } from "@project516/util";

const require = createRequire(import.meta.url);
const { VIDEO_1S_MP4, b64ToUint8Array } = require("./test-helper-browser.js");

const FFMPEG_TYPE = process.env.FFMPEG_TYPE === "mt" ? "mt" : "st";
const genName = (name) => `[ffmpeg][node:${FFMPEG_TYPE}] ${name}`;

// The st core is resolved from node_modules by FFmpeg.load() itself when no
// coreURL is given (@project516/core). The mt core has no such default, so
// it is pointed at explicitly.
const coreURL =
  FFMPEG_TYPE === "mt" ?
    new URL("../packages/core-mt/dist/esm/ffmpeg-core.js", import.meta.url)
      .href :
    undefined;

describe(genName("FFmpeg"), function () {
  this.timeout(60000);

  let ffmpeg;

  before(async () => {
    ffmpeg = new FFmpeg();
    await ffmpeg.load(coreURL ? { coreURL } : {});
  });

  after(() => {
    ffmpeg.terminate();
  });

  it("loads", () => {
    expect(ffmpeg.loaded).to.be.true;
  });

  it("runs ffmpeg -h off the main thread", async () => {
    const ret = await ffmpeg.exec(["-h"]);
    expect(ret).to.equal(0);
  });

  it("writes and reads a text file", async () => {
    await ffmpeg.writeFile("/hello.txt", "hello world");
    const data = await ffmpeg.readFile("/hello.txt", "utf8");
    expect(data).to.equal("hello world");
    await ffmpeg.deleteFile("/hello.txt");
  });

  it("transcodes a small video", async () => {
    await ffmpeg.writeFile(
      "video.mp4",
      await fetchFile(`data:video/mp4;base64,${VIDEO_1S_MP4}`)
    );
    const ret = await ffmpeg.exec(["-i", "video.mp4", "video.avi"]);
    expect(ret).to.equal(0);
    const out = await ffmpeg.readFile("video.avi");
    expect(out.length).to.not.equal(0);
    await ffmpeg.deleteFile("video.mp4");
    await ffmpeg.deleteFile("video.avi");
  });

  it("runs ffprobe", async () => {
    await ffmpeg.writeFile(
      "probe.mp4",
      b64ToUint8Array(VIDEO_1S_MP4)
    );
    const ret = await ffmpeg.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "probe.mp4",
      "-o",
      "probe_out.txt",
    ]);
    // ffprobe.c returns from main() without going through cmdutils.c's
    // exit_program() on success, so unlike exec(), ret does not reliably
    // become 0; the output file is what confirms it ran.
    expect(ret).to.not.equal(1);
    const out = await ffmpeg.readFile("probe_out.txt", "utf8");
    expect(parseFloat(out)).to.be.greaterThan(0);
    await ffmpeg.deleteFile("probe.mp4");
    await ffmpeg.deleteFile("probe_out.txt");
  });

  it("stops exec() after the given timeout", async () => {
    await ffmpeg.writeFile(
      "timeout.mp4",
      b64ToUint8Array(VIDEO_1S_MP4)
    );
    const ret = await ffmpeg.exec(
      ["-i", "timeout.mp4", "timeout.avi"],
      1 // 1ms, well under the time a transcode takes
    );
    expect(ret).to.equal(1);
    await ffmpeg.deleteFile("timeout.mp4");
  });
});

describe(genName("FFmpeg.terminate()"), function () {
  this.timeout(60000);

  it("rejects pending calls and unloads", async () => {
    const ffmpeg = new FFmpeg();
    await ffmpeg.load(coreURL ? { coreURL } : {});

    const pending = ffmpeg.exec(["-i", "does-not-exist.mp4", "out.mp4"]);
    ffmpeg.terminate();

    let rejected = false;
    try {
      await pending;
    } catch {
      rejected = true;
    }
    expect(rejected).to.be.true;
    expect(ffmpeg.loaded).to.be.false;
  });
});
