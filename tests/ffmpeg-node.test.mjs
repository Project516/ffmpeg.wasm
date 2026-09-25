// Node.js tests for the @project516/ffmpeg-wasm wrapper: load, every
// FFMessageType the worker handles (exec, ffprobe, the filesystem calls,
// mount/unmount, log/progress events), a timeout, and terminate, run
// against both the st and the mt core. Select the core with a --mt
// argument (defaults to st); see the test:node:ffmpeg:* scripts in the
// root package.json. A CLI flag, not an environment variable, so the
// scripts stay portable to Windows' default shell.
//
// worker.ts and worker-node-entry.mts each implement their own copy of the
// message dispatch (see the comment on that in worker-node-entry.mts); the
// coverage here is what would catch the two drifting.
import { createRequire } from "node:module";
import { mkdtemp, writeFile as writeFileFs, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "chai";
import { FFmpeg } from "@project516/ffmpeg-wasm";
import { fetchFile } from "@project516/ffmpeg-wasm-util";

const require = createRequire(import.meta.url);
const { VIDEO_1S_MP4, b64ToUint8Array } = require("./test-helper-browser.js");

const FFMPEG_TYPE = process.argv.includes("--mt") ? "mt" : "st";
const genName = (name) => `[ffmpeg][node:${FFMPEG_TYPE}] ${name}`;

// The st core is resolved from node_modules by FFmpeg.load() itself when
// no coreURL is given (@project516/ffmpeg-wasm-core). The mt core has no
// such default, so it is pointed at explicitly; see the Node.js section
// of the usage docs.
const coreURL =
  FFMPEG_TYPE === "mt" ?
    new URL("../packages/core-mt/dist/esm/ffmpeg-core.js", import.meta.url)
      .href :
    undefined;

const load = (ffmpeg) => ffmpeg.load(coreURL ? { coreURL } : {});

// fetchFile()'s local-path and file: URL branches only run under Node.js,
// so the browser test suite can't cover them; both core-variant commands
// run this same suite, but fetchFile() itself doesn't touch the core.
describe(genName("fetchFile() local files"), function () {
  this.timeout(60000);

  let dir;
  let filePath;
  const expected = b64ToUint8Array(VIDEO_1S_MP4);

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "ffmpeg-wasm-test-"));
    filePath = join(dir, "video.mp4");
    await writeFileFs(filePath, expected);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a local path", async () => {
    const data = await fetchFile(filePath);
    expect(Buffer.from(data)).to.deep.equal(Buffer.from(expected));
  });

  it("reads a file: URL", async () => {
    const data = await fetchFile(pathToFileURL(filePath));
    expect(Buffer.from(data)).to.deep.equal(Buffer.from(expected));
  });
});

describe(genName("global Worker leakage"), function () {
  this.timeout(60000);

  it("does not install a global Worker before load()", () => {
    expect(typeof globalThis.Worker).to.equal("undefined");
  });

  it("does not leave a global Worker installed after load()", async () => {
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    try {
      expect(typeof globalThis.Worker).to.equal("undefined");
    } finally {
      ffmpeg.terminate();
    }
  });
});

describe(genName("concurrent load()"), function () {
  this.timeout(60000);

  it("resolves first=true for exactly one of two concurrent load() calls", async () => {
    const ffmpeg = new FFmpeg();
    try {
      const [a, b] = await Promise.all([load(ffmpeg), load(ffmpeg)]);
      expect([a, b].filter(Boolean)).to.have.lengthOf(1);
    } finally {
      ffmpeg.terminate();
    }
  });

  it("still resolves first=true on the first successful load() after an earlier one failed", async () => {
    const ffmpeg = new FFmpeg();
    try {
      let failed = false;
      try {
        await ffmpeg.load({ coreURL: "file:///does-not-exist.js" });
      } catch {
        failed = true;
      }
      expect(failed).to.be.true;

      const first = await load(ffmpeg);
      expect(first).to.be.true;
    } finally {
      ffmpeg.terminate();
    }
  });
});

describe(genName("FFmpeg"), function () {
  this.timeout(60000);

  let ffmpeg;

  before(async () => {
    ffmpeg = new FFmpeg();
    await load(ffmpeg);
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

  it("emits log events during exec()", async () => {
    const logs = [];
    const onLog = (event) => logs.push(event.message);
    ffmpeg.on("log", onLog);
    try {
      await ffmpeg.exec(["-h"]);
    } finally {
      ffmpeg.off("log", onLog);
    }
    expect(logs.length).to.not.equal(0);
  });

  it("writes and reads a text file", async () => {
    await ffmpeg.writeFile("/hello.txt", "hello world");
    const data = await ffmpeg.readFile("/hello.txt", "utf8");
    expect(data).to.equal("hello world");
    await ffmpeg.deleteFile("/hello.txt");
  });

  it("renames a file", async () => {
    await ffmpeg.writeFile("/old.txt", "content");
    await ffmpeg.rename("/old.txt", "/new.txt");
    const data = await ffmpeg.readFile("/new.txt", "utf8");
    expect(data).to.equal("content");
    await ffmpeg.deleteFile("/new.txt");
  });

  it("creates, lists, and deletes a directory", async () => {
    await ffmpeg.createDir("/adir");
    const files = await ffmpeg.listDir("/");
    expect(files.map(({ name }) => name)).to.include("adir");
    await ffmpeg.deleteDir("/adir");
    const filesAfter = await ffmpeg.listDir("/");
    expect(filesAfter.map(({ name }) => name)).to.not.include("adir");
  });

  it("mounts and unmounts a filesystem", async () => {
    // MEMFS needs no browser-only Blob/File input, unlike WORKERFS, so it
    // exercises the MOUNT/UNMOUNT dispatch without relying on inputs this
    // wrapper cannot construct outside a browser.
    await ffmpeg.createDir("/work");
    await ffmpeg.mount("MEMFS", {}, "/work");
    await ffmpeg.unmount("/work");
    await ffmpeg.deleteDir("/work");
  });

  it("transcodes a small video and reports progress", async () => {
    let progress = 0;
    const onProgress = (event) => (progress = event.progress);
    ffmpeg.on("progress", onProgress);

    await ffmpeg.writeFile(
      "video.mp4",
      await fetchFile(`data:video/mp4;base64,${VIDEO_1S_MP4}`)
    );
    const ret = await ffmpeg.exec(["-i", "video.mp4", "video.avi"]);
    ffmpeg.off("progress", onProgress);

    expect(ret).to.equal(0);
    expect(progress).to.equal(1);
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
    await load(ffmpeg);

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

  it("still works after terminate() followed by a fresh load()", async () => {
    // A worker that was actually running reports its exit a beat after
    // terminate() itself resolves. Reusing the same FFmpeg instance right
    // away means that stale event arrives while the new worker (from the
    // load() below) is already in use; it must not affect it.
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    ffmpeg.terminate();

    await load(ffmpeg);
    try {
      const ret = await ffmpeg.exec(["-h"]);
      expect(ret).to.equal(0);
    } finally {
      ffmpeg.terminate();
    }
  });
});
