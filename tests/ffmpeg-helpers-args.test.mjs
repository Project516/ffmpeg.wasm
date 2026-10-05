// Tests probe(), transcode() and extractFrames() against an in-memory
// stand-in for FFmpeg, so they run without a core: argument building, input
// handling, error reporting and cleanup. tests/ffmpeg-helpers.test.mjs runs
// the same helpers against the real cores.
import { expect } from "chai";
import { extractFrames, probe, transcode } from "@project516/ffmpeg-wasm";

class FakeFFmpeg {
  files = new Map();
  dirs = new Set(["/"]);
  execs = [];
  probes = [];
  signals = [];
  logs = [];
  listeners = { log: [], progress: [] };
  // Called by exec()/ffprobe() with the args; may write output files.
  onRun = () => 0;

  on(event, cb) {
    this.listeners[event].push(cb);
  }
  off(event, cb) {
    this.listeners[event] = this.listeners[event].filter((f) => f !== cb);
  }
  emit(event, data) {
    for (const cb of this.listeners[event]) cb(data);
  }

  async exec(args, timeout, { signal } = {}) {
    this.execs.push({ args, timeout });
    this.signals.push(signal);
    return this.onRun(args);
  }
  async ffprobe(args, timeout, { signal } = {}) {
    this.probes.push({ args, timeout });
    this.signals.push(signal);
    return this.onRun(args);
  }
  async createDir(path) {
    if (this.dirs.has(path)) throw new Error("exists");
    this.dirs.add(path);
    return true;
  }
  async deleteDir(path) {
    for (const f of this.files.keys()) {
      if (f.startsWith(`${path}/`)) throw new Error("not empty");
    }
    this.dirs.delete(path);
    return true;
  }
  async listDir(path) {
    const names = [".", ".."];
    for (const f of this.files.keys()) {
      if (f.startsWith(`${path}/`)) names.push(f.slice(path.length + 1));
    }
    return names.map((name) => ({ name, isDir: name === "." || name === ".." }));
  }
  async writeFile(path, data) {
    // The real writeFile() transfers the buffer to the worker.
    if (data instanceof Uint8Array) {
      this.files.set(path, new Uint8Array(structuredClone(data, { transfer: [data.buffer] })));
    } else {
      this.files.set(path, data);
    }
    return true;
  }
  async readFile(path, encoding = "binary") {
    if (!this.files.has(path)) throw new Error(`no such file ${path}`);
    const data = this.files.get(path);
    return encoding === "utf8" && typeof data !== "string" ? new TextDecoder().decode(data) : data;
  }
  async deleteFile(path) {
    this.files.delete(path);
    return true;
  }
}

const bytes = (...values) => Uint8Array.from(values);
const outputOf = (args) => args[args.length - 1];

describe("[helpers] probe()", () => {
  it("runs ffprobe on a private copy of the input and returns the parsed JSON", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      const out = args[args.indexOf("-o") + 1];
      ffmpeg.files.set(out, JSON.stringify({ format: { format_name: "mov,mp4" }, streams: [{ index: 0 }] }));
      return 0;
    };
    const input = bytes(1, 2, 3);
    const info = await probe(ffmpeg, input);

    expect(info.format.format_name).to.equal("mov,mp4");
    expect(info.streams).to.have.lengthOf(1);
    expect(input.byteLength, "caller's buffer is not detached").to.equal(3);
    expect(ffmpeg.probes[0].args).to.include.members(["-show_format", "-show_streams", "json"]);
  });

  it("removes its files and directory", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      ffmpeg.files.set(args[args.indexOf("-o") + 1], '{"format":{}}');
      return 0;
    };
    await probe(ffmpeg, bytes(1));
    expect(ffmpeg.files.size).to.equal(0);
    expect([...ffmpeg.dirs]).to.deep.equal(["/"]);
  });

  it("rejects with the log tail when ffprobe wrote no usable output", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = () => {
      ffmpeg.emit("log", { type: "stderr", message: "Invalid data found when processing input" });
      return 1;
    };
    let error;
    try {
      await probe(ffmpeg, bytes(1));
    } catch (e) {
      error = e;
    }
    expect(error.message).to.match(/probe failed \(exit code 1\)/).and.to.match(/Invalid data found/);
    expect(ffmpeg.files.size).to.equal(0);
    expect(ffmpeg.listeners.log).to.have.lengthOf(0);
  });

  it("treats a good output as success whatever the exit code", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      ffmpeg.files.set(args[args.indexOf("-o") + 1], '{"format":{"duration":"1.0"}}');
      return -1;
    };
    const info = await probe(ffmpeg, bytes(1));
    expect(info.format.duration).to.equal("1.0");
    expect(info.streams).to.deep.equal([]);
  });

  it("accepts a Blob, a File and a URL, and keeps the file extension", async () => {
    const ffmpeg = new FakeFFmpeg();
    const seen = [];
    ffmpeg.onRun = (args) => {
      seen.push(args[args.indexOf("-show_streams") + 1]);
      ffmpeg.files.set(args[args.indexOf("-o") + 1], '{"format":{}}');
      return 0;
    };
    await probe(ffmpeg, new Blob([bytes(1)]));
    await probe(ffmpeg, new File([bytes(1)], "clip.MP4"));
    await probe(ffmpeg, new URL("data:application/octet-stream;base64,AQID"));
    expect(seen[0]).to.match(/\/input$/);
    expect(seen[1]).to.match(/\/input\.mp4$/);
    expect(seen[2]).to.match(/\/input$/);
  });

  it("rejects an input that is not media", async () => {
    let error;
    try {
      await probe(new FakeFFmpeg(), "video.mp4");
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(TypeError);
  });

  it("passes the timeout and signal to ffprobe", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      ffmpeg.files.set(args[args.indexOf("-o") + 1], '{"format":{}}');
      return 0;
    };
    const controller = new AbortController();
    await probe(ffmpeg, bytes(1), { timeout: 500, signal: controller.signal });
    expect(ffmpeg.probes[0].timeout).to.equal(500);
    expect(ffmpeg.signals[0]).to.equal(controller.signal);
  });

  it("rejects a signal that is already aborted, before touching the file system", async () => {
    const ffmpeg = new FakeFFmpeg();
    const controller = new AbortController();
    controller.abort();
    let error;
    try {
      await probe(ffmpeg, bytes(1), { signal: controller.signal });
    } catch (e) {
      error = e;
    }
    expect(error.name).to.equal("AbortError");
    expect(ffmpeg.dirs.size).to.equal(1);
  });

  it("rejects a timeout of zero, which would stop ffmpeg at once", async () => {
    let rejected = false;
    try {
      await probe(new FakeFFmpeg(), bytes(1), { timeout: 0 });
    } catch {
      rejected = true;
    }
    expect(rejected).to.be.true;
  });

  it("uses a separate directory for concurrent calls", async () => {
    const ffmpeg = new FakeFFmpeg();
    const dirs = [];
    ffmpeg.onRun = (args) => {
      const out = args[args.indexOf("-o") + 1];
      dirs.push(out.slice(0, out.lastIndexOf("/")));
      ffmpeg.files.set(out, '{"format":{}}');
      return 0;
    };
    await Promise.all([probe(ffmpeg, bytes(1)), probe(ffmpeg, bytes(2))]);
    expect(new Set(dirs).size).to.equal(2);
  });
});

describe("[helpers] transcode()", () => {
  const run = async (options, ret = 0) => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      if (ret === 0) ffmpeg.files.set(outputOf(args), bytes(9, 9));
      return ret;
    };
    const out = await transcode(ffmpeg, bytes(1), options);
    return { ffmpeg, out, args: ffmpeg.execs[0].args };
  };

  it("builds the command and returns the output bytes", async () => {
    const { out, args } = await run({
      format: "webm",
      videoCodec: "libvpx-vp9",
      audioCodec: "libopus",
      videoBitrate: "500k",
      audioBitrate: 96000,
      width: 640,
      fps: 24,
      sampleRate: 48000,
      channels: 2,
      start: 1.5,
      duration: 4,
      args: ["-crf", "35"],
    });
    expect(out).to.deep.equal(bytes(9, 9));
    expect(args.slice(0, 2)).to.deep.equal(["-ss", "1.5"]);
    expect(args[args.indexOf("-i") - 1]).to.equal("1.5");
    expect(args).to.include.members(["-c:v", "libvpx-vp9", "-c:a", "libopus", "-b:v", "500k", "-b:a", "96000"]);
    expect(args[args.indexOf("-vf") + 1]).to.equal("scale=640:-2");
    expect(args[args.indexOf("-r") + 1]).to.equal("24");
    expect(args[args.indexOf("-ar") + 1]).to.equal("48000");
    expect(args[args.indexOf("-ac") + 1]).to.equal("2");
    expect(args[args.indexOf("-t") + 1]).to.equal("4");
    expect(args.slice(-3, -1)).to.deep.equal(["-crf", "35"]);
    expect(outputOf(args)).to.match(/\/output\.webm$/);
  });

  it("drops streams on request", async () => {
    const { args } = await run({ format: "mp3", noVideo: true });
    expect(args).to.include("-vn");
    const audio = await run({ format: "mp4", noAudio: true });
    expect(audio.args).to.include("-an");
  });

  it("rejects with the exit code, and cleans up", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = () => {
      ffmpeg.emit("log", { type: "stderr", message: "Unknown encoder 'nope'" });
      return 1;
    };
    let error;
    try {
      await transcode(ffmpeg, bytes(1), { format: "mp4", videoCodec: "nope" });
    } catch (e) {
      error = e;
    }
    expect(error.message).to.match(/transcode failed \(exit code 1\)/).and.to.match(/Unknown encoder/);
    expect(ffmpeg.files.size).to.equal(0);
    expect([...ffmpeg.dirs]).to.deep.equal(["/"]);
  });

  it("reports progress only while the command runs", async () => {
    const ffmpeg = new FakeFFmpeg();
    const seen = [];
    ffmpeg.onRun = (args) => {
      ffmpeg.emit("progress", { progress: 0.5, time: 1 });
      ffmpeg.files.set(outputOf(args), bytes(1));
      return 0;
    };
    await transcode(ffmpeg, bytes(1), { format: "mp4", onProgress: (e) => seen.push(e.progress) });
    ffmpeg.emit("progress", { progress: 1, time: 2 });
    expect(seen).to.deep.equal([0.5]);
  });

  for (const [name, options] of [
    ["a missing format", {}],
    ["a format that is not an extension", { format: "mp4 -f null" }],
    ["a negative width", { format: "mp4", width: -1 }],
    ["a zero fps", { format: "mp4", fps: 0 }],
    ["a negative start", { format: "mp4", start: -1 }],
  ]) {
    it(`rejects ${name} before touching the file system`, async () => {
      const ffmpeg = new FakeFFmpeg();
      let rejected = false;
      try {
        await transcode(ffmpeg, bytes(1), options);
      } catch {
        rejected = true;
      }
      expect(rejected).to.be.true;
      expect(ffmpeg.execs).to.have.lengthOf(0);
      expect(ffmpeg.dirs.size).to.equal(1);
    });
  }
});

describe("[helpers] extractFrames()", () => {
  const run = async (options, frames = 3) => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      const pattern = outputOf(args);
      for (let i = 1; i <= frames; i++) {
        ffmpeg.files.set(pattern.replace("%06d", String(i).padStart(6, "0")), bytes(i));
      }
      return 0;
    };
    const out = await extractFrames(ffmpeg, bytes(1), options);
    return { ffmpeg, out, args: ffmpeg.execs[0].args };
  };

  it("returns the frames in order and cleans up", async () => {
    const { ffmpeg, out } = await run({});
    expect(out).to.deep.equal([bytes(1), bytes(2), bytes(3)]);
    expect(ffmpeg.files.size).to.equal(0);
  });

  it("defaults to png and builds the filter chain", async () => {
    const { args } = await run({ fps: 2, width: 320, height: 180, count: 4, start: 3, duration: 5 });
    expect(outputOf(args)).to.match(/frame-%06d\.png$/);
    expect(args.slice(0, 2)).to.deep.equal(["-ss", "3"]);
    expect(args[args.indexOf("-vf") + 1]).to.equal("fps=2,scale=320:180");
    expect(args[args.indexOf("-frames:v") + 1]).to.equal("4");
    expect(args[args.indexOf("-t") + 1]).to.equal("5");
    expect(args).to.include("-an");
  });

  it("sets a quality for jpg", async () => {
    const { args } = await run({ format: "jpg" });
    expect(outputOf(args)).to.match(/\.jpg$/);
    expect(args[args.indexOf("-q:v") + 1]).to.equal("2");
  });

  it("orders frames numerically past the padded width", async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.onRun = (args) => {
      const pattern = outputOf(args);
      for (const n of [999999, 1000000, 2]) {
        ffmpeg.files.set(pattern.replace("%06d", String(n).padStart(6, "0")), bytes(n % 256));
      }
      return 0;
    };
    const out = await extractFrames(ffmpeg, bytes(1));
    expect(out.map((f) => f[0])).to.deep.equal([2, 999999 % 256, 1000000 % 256]);
  });

  it("returns an empty list when ffmpeg wrote no frames", async () => {
    const { out } = await run({}, 0);
    expect(out).to.deep.equal([]);
  });

  it("rejects an unknown format and a bad count", async () => {
    for (const options of [{ format: "bmp" }, { count: 0 }]) {
      let rejected = false;
      try {
        await extractFrames(new FakeFFmpeg(), bytes(1), options);
      } catch {
        rejected = true;
      }
      expect(rejected).to.be.true;
    }
  });
});
