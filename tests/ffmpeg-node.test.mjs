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
import {
  mkdtemp,
  readFile as readFileFs,
  writeFile as writeFileFs,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

const corePath = fileURLToPath(
  new URL(
    `../packages/core${FFMPEG_TYPE === "mt" ? "-mt" : ""}/dist/esm/ffmpeg-core.js`,
    import.meta.url
  )
);

const load = (ffmpeg) => ffmpeg.load(coreURL ? { coreURL } : {});

// Endless input, so a command cannot finish before the call is settled.
const ENDLESS = ["-f", "lavfi", "-i", "testsrc=d=600:s=16x16", "-f", "null", "-"];

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

describe(genName("fetchFile() Blob"), function () {
  it("reads a Blob without FileReader", async () => {
    expect(globalThis.FileReader).to.be.undefined;
    const data = await fetchFile(new Blob([new Uint8Array([1, 2, 3])]));
    expect(Array.from(data)).to.deep.equal([1, 2, 3]);
  });
});

describe(genName("FFmpeg through a Proxy"), function () {
  it("on() and off() work like Vue's reactive()", () => {
    const ffmpeg = new Proxy(new FFmpeg(), {});
    const cb = () => {};
    ffmpeg.on("log", cb);
    ffmpeg.off("log", cb);
    ffmpeg.on("progress", cb);
    ffmpeg.off("progress", cb);
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

  it("keeps the loaded core when load() is called again", async () => {
    const ffmpeg = new FFmpeg();
    try {
      expect(await load(ffmpeg)).to.be.true;
      await ffmpeg.writeFile("/kept.txt", "hello");
      expect(await load(ffmpeg)).to.be.false;
      expect(await ffmpeg.readFile("/kept.txt", "utf8")).to.equal("hello");
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

describe(genName("load() inputs"), function () {
  this.timeout(60000);

  it("accepts filesystem paths for coreURL and wasmURL", async () => {
    const ffmpeg = new FFmpeg();
    try {
      await ffmpeg.load({
        coreURL: corePath,
        wasmURL: corePath.replace(/\.js$/, ".wasm"),
      });
      expect(ffmpeg.loaded).to.be.true;
    } finally {
      ffmpeg.terminate();
    }
  });

  it("names the wasmURL when it is not a WebAssembly file", async () => {
    const ffmpeg = new FFmpeg();
    try {
      let message = "";
      try {
        await ffmpeg.load({ coreURL: corePath, wasmURL: corePath });
      } catch (e) {
        message = String(e);
      }
      expect(message).to.include("not a WebAssembly file");
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

  it("does not mount a name that only exists on the prototype", async () => {
    expect(await ffmpeg.mount("__proto__", {}, "/proto")).to.be.false;
    expect(await ffmpeg.mount("constructor", {}, "/proto")).to.be.false;
  });

  it("writeFile() transfers the buffer unless transfer is false", async () => {
    const kept = new Uint8Array([1, 2, 3]);
    await ffmpeg.writeFile("/kept.bin", kept, { transfer: false });
    expect(Array.from(kept)).to.deep.equal([1, 2, 3]);
    const moved = new Uint8Array([1, 2, 3]);
    await ffmpeg.writeFile("/moved.bin", moved);
    expect(moved.length).to.equal(0);
    const read = await ffmpeg.readFile("/kept.bin");
    expect(Array.from(read)).to.deep.equal([1, 2, 3]);
    await ffmpeg.deleteFile("/kept.bin");
    await ffmpeg.deleteFile("/moved.bin");
  });

  it("writes in chunks and reads back with open/read/write/close", async () => {
    const fd = await ffmpeg.open("/chunked.bin", "w");
    expect(await ffmpeg.write(fd, Uint8Array.from([1, 2, 3]))).to.equal(3);
    expect(await ffmpeg.write(fd, Uint8Array.from([4, 5]))).to.equal(2);
    await ffmpeg.close(fd);
    expect(Array.from(await ffmpeg.readFile("/chunked.bin"))).to.deep.equal([
      1, 2, 3, 4, 5,
    ]);

    const rfd = await ffmpeg.open("/chunked.bin", "r");
    expect(Array.from(await ffmpeg.read(rfd, 2))).to.deep.equal([1, 2]);
    expect(Array.from(await ffmpeg.read(rfd, 4, 1))).to.deep.equal([
      2, 3, 4, 5,
    ]);
    expect(await ffmpeg.read(rfd, 4, 5)).to.have.length(0);
    expect(Array.from(await ffmpeg.read(rfd, 2 ** 31, 3))).to.deep.equal([4, 5]);
    await ffmpeg.close(rfd);
    await ffmpeg.deleteFile("/chunked.bin");
  });

  it("rejects use of a closed file descriptor", async () => {
    const fd = await ffmpeg.open("/closed.bin", "w");
    await ffmpeg.close(fd);
    for (const use of [
      () => ffmpeg.write(fd, Uint8Array.from([1])),
      () => ffmpeg.read(fd, 1),
      () => ffmpeg.close(fd),
    ]) {
      let error;
      try {
        await use();
      } catch (e) {
        error = e;
      }
      expect(error).to.not.equal(undefined);
    }
    await ffmpeg.deleteFile("/closed.bin");
  });

  it("write() transfers the buffer unless transfer is false", async () => {
    const fd = await ffmpeg.open("/wt.bin", "w");
    const kept = Uint8Array.from([1, 2]);
    await ffmpeg.write(fd, kept, undefined, { transfer: false });
    expect(kept.length).to.equal(2);
    const moved = Uint8Array.from([3, 4]);
    await ffmpeg.write(fd, moved);
    expect(moved.length).to.equal(0);
    await ffmpeg.close(fd);
    await ffmpeg.deleteFile("/wt.bin");
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

  // -re paces input at its native rate, so the job outlasts the timeout.
  it("stops exec() after the given timeout", async () => {
    await ffmpeg.writeFile(
      "timeout.mp4",
      b64ToUint8Array(VIDEO_1S_MP4)
    );
    const ret = await ffmpeg.exec(
      ["-re", "-i", "timeout.mp4", "timeout.avi"],
      1 // 1ms, well under the time a transcode takes
    );
    expect(ret).to.equal(1);
    await ffmpeg.deleteFile("timeout.mp4");
  });
});

describe(genName("exec() abort signal"), function () {
  this.timeout(60000);

  it("stops the running command and frees the worker", async () => {
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    try {
      const controller = new AbortController();
      const started = new Promise((resolve) => {
        const onLog = ({ message }) => {
          if (!message.startsWith("Output #0")) return;
          ffmpeg.off("log", onLog);
          resolve();
        };
        ffmpeg.on("log", onLog);
      });
      // Never ends on its own, so a later call only returns if abort stopped it.
      const running = ffmpeg.exec(
        ["-re", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10", "-f", "null", "-"],
        -1,
        { signal: controller.signal }
      );
      await started;
      controller.abort();

      let error;
      try {
        await running;
      } catch (e) {
        error = e;
      }
      expect(error.name).to.equal("AbortError");

      const next = await Promise.race([
        ffmpeg.exec(["-h"]),
        new Promise((resolve) => setTimeout(resolve, 10000, "timed out")),
      ]);
      expect(next).to.equal(0);
    } finally {
      ffmpeg.terminate();
    }
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

  const message = async (promise) => {
    try {
      await promise;
    } catch (err) {
      return String(err.message ?? err);
    }
    return undefined;
  };

  it("rejects pending calls with the terminate error", async () => {
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    const pending = ffmpeg.exec(ENDLESS);
    ffmpeg.terminate();
    expect(await message(pending)).to.match(/terminate/);
  });

  it("rejects calls made after terminate()", async () => {
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    ffmpeg.terminate();
    expect(await message(ffmpeg.listDir("/"))).to.match(/not loaded/);
  });

  it("loads again with a fresh file system", async () => {
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    await ffmpeg.writeFile("/before", "x");
    ffmpeg.terminate();
    try {
      expect(await load(ffmpeg)).to.be.true;
      const names = (await ffmpeg.listDir("/")).map(({ name }) => name);
      expect(names).to.not.include("before");
    } finally {
      ffmpeg.terminate();
    }
  });

  it("does nothing when never loaded", () => {
    expect(() => new FFmpeg().terminate()).to.not.throw();
  });
});

describe(genName("abort signal"), function () {
  this.timeout(60000);

  const abortName = async (call) => {
    const controller = new AbortController();
    const pending = call(controller.signal);
    controller.abort();
    try {
      await pending;
    } catch (err) {
      return err.name;
    }
    return undefined;
  };

  it("rejects exec() and file calls with an AbortError", async () => {
    const ffmpeg = new FFmpeg();
    await load(ffmpeg);
    try {
      expect(
        await abortName((signal) => ffmpeg.exec(ENDLESS, -1, { signal }))
      ).to.equal("AbortError");
      expect(
        await abortName((signal) => ffmpeg.listDir("/", { signal }))
      ).to.equal("AbortError");
    } finally {
      ffmpeg.terminate();
    }
  });
});

describe(genName("repeated calls and exit codes"), function () {
  this.timeout(60000);

  let ffmpeg;

  before(async () => {
    ffmpeg = new FFmpeg();
    await load(ffmpeg);
    await ffmpeg.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
  });

  after(() => {
    ffmpeg.terminate();
  });

  it("produces identical output across exec() runs", async () => {
    const outputs = [];
    for (let i = 0; i < 3; i++) {
      const ret = await ffmpeg.exec([
        "-f", "lavfi", "-i", "testsrc=d=0.3:s=32x24:r=10",
        "-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", "repeat.y4m",
      ]);
      expect(ret).to.equal(0);
      outputs.push(Buffer.from(await ffmpeg.readFile("repeat.y4m")));
      await ffmpeg.deleteFile("repeat.y4m");
    }
    expect(outputs[0].length).to.not.equal(0);
    for (const out of outputs) expect(out).to.deep.equal(outputs[0]);
  });

  it("does not keep ffprobe options between calls", async () => {
    const streams = async (...args) => {
      await ffmpeg.ffprobe([
        "-v", "error", "-print_format", "json", ...args, "video.mp4", "-o", "p.json",
      ]);
      const json = JSON.parse(await ffmpeg.readFile("p.json", "utf8"));
      await ffmpeg.deleteFile("p.json");
      return json.streams;
    };
    expect(await streams("-show_streams", "-select_streams", "a")).to.have.lengthOf(0);
    expect(await streams("-show_streams")).to.have.lengthOf(1);
  });

  it("returns non-zero for bad arguments, a missing input and an unknown encoder", async () => {
    expect(await ffmpeg.exec(["-definitely-not-an-option"])).to.not.equal(0);
    expect(await ffmpeg.exec(["-i", "missing.mp4", "missing.avi"])).to.not.equal(0);
    expect(
      await ffmpeg.exec([
        "-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.1", "-c:v", "no-such-encoder", "bad.mp4",
      ])
    ).to.not.equal(0);
  });

  it("runs again after a failure", async () => {
    expect(await ffmpeg.exec(["-definitely-not-an-option"])).to.not.equal(0);
    expect(await ffmpeg.exec(["-i", "video.mp4", "-f", "null", "-"])).to.equal(0);
  });
});

describe(genName("core glue"), function () {
  // bind.js shares a scope with Emscripten's glue, so a top-level function
  // named like a global replaces it for the glue too.
  it("declares no top-level function named like a global", async () => {
    const bind = await readFileFs(
      new URL("../src/bind/ffmpeg/bind.js", import.meta.url),
      "utf8"
    );
    const names = [...bind.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
    expect(names).to.include("exec");
    expect(names.filter((name) => name in globalThis)).to.deep.equal([]);
  });
});
