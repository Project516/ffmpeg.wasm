// Runs probe(), transcode() and extractFrames() against a real core under
// Node.js. Select the core with a --mt or --jspi argument (defaults to st), like
// tests/ffmpeg-node.test.mjs. tests/ffmpeg-helpers-args.test.mjs covers the
// argument building without a core.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "chai";
import { FFmpeg, extractFrames, probe, transcode } from "@project516/ffmpeg-wasm";

const require = createRequire(import.meta.url);
const { VIDEO_1S_MP4, b64ToUint8Array } = require("./test-helper-browser.js");

const FFMPEG_TYPE = process.argv.includes("--mt") ? "mt" : process.argv.includes("--jspi") ? "jspi" : "st";
const genName = (name) => `[helpers][node:${FFMPEG_TYPE}] ${name}`;

const coreURL =
  FFMPEG_TYPE === "st" ?
    undefined :
    new URL(`../packages/core-${FFMPEG_TYPE}/dist/esm/ffmpeg-core.js`, import.meta.url).href;

const videoStream = (info) => info.streams.find((s) => s.codec_type === "video");
const isPng = (data) => data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;

describe(genName("helpers"), function () {
  this.timeout(120000);

  let ffmpeg;
  let video;

  before(async () => {
    ffmpeg = new FFmpeg();
    await ffmpeg.load(coreURL ? { coreURL } : {});
    video = b64ToUint8Array(VIDEO_1S_MP4);
  });

  after(() => {
    ffmpeg.terminate();
  });

  const leftovers = async () =>
    (await ffmpeg.listDir("/")).map(({ name }) => name).filter((name) => name.startsWith("ffmpeg-wasm-job-"));

  describe("probe()", () => {
    it("reads a Uint8Array without detaching it", async () => {
      const input = video.slice();
      const info = await probe(ffmpeg, input);
      expect(info.format.format_name).to.include("mp4");
      expect(Number(info.format.duration)).to.be.greaterThan(0);
      const stream = videoStream(info);
      expect(stream.codec_name).to.equal("h264");
      expect(stream.width).to.be.greaterThan(0);
      expect(stream.height).to.be.greaterThan(0);
      expect(input.byteLength).to.equal(video.byteLength);
      expect(await leftovers()).to.deep.equal([]);
    });

    it("reads a Blob, a File and a data: URL", async () => {
      const [fromBlob, fromFile, fromURL] = [
        await probe(ffmpeg, new Blob([video])),
        await probe(ffmpeg, new File([video], "clip.mp4")),
        await probe(ffmpeg, new URL(`data:video/mp4;base64,${VIDEO_1S_MP4}`)),
      ];
      for (const info of [fromBlob, fromFile, fromURL]) {
        expect(info.format.format_name).to.include("mp4");
      }
    });

    it("reads a file: URL", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ffmpeg-wasm-helpers-"));
      try {
        const path = join(dir, "clip.mp4");
        await writeFile(path, video);
        const info = await probe(ffmpeg, pathToFileURL(path));
        expect(info.format.format_name).to.include("mp4");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("rejects data that is not media, and cleans up", async () => {
      let error;
      try {
        await probe(ffmpeg, new Uint8Array(2048).fill(7));
      } catch (e) {
        error = e;
      }
      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.match(/^probe failed/);
      expect(await leftovers()).to.deep.equal([]);
    });
  });

  describe("transcode()", () => {
    it("converts to another container and codec", async () => {
      const out = await transcode(ffmpeg, video, { format: "avi" });
      const info = await probe(ffmpeg, out);
      expect(info.format.format_name).to.equal("avi");
      expect(await leftovers()).to.deep.equal([]);
    });

    it("scales, and reports progress", async () => {
      const progress = [];
      const out = await transcode(ffmpeg, new Blob([video]), {
        format: "mp4",
        videoCodec: "libx264",
        width: 64,
        onProgress: (event) => progress.push(event.progress),
      });
      const stream = videoStream(await probe(ffmpeg, out));
      expect(stream.width).to.equal(64);
      expect(stream.height % 2).to.equal(0);
      expect(progress.length).to.be.greaterThan(0);
    });

    it("passes encoder options through", async () => {
      const out = await transcode(ffmpeg, video, {
        format: "webm",
        videoCodec: "libvpx-vp9",
        args: ["-deadline", "realtime", "-cpu-used", "8"],
      });
      const info = await probe(ffmpeg, out);
      expect(info.format.format_name).to.include("webm");
      expect(videoStream(info).codec_name).to.equal("vp9");
    });

    it("rejects an unknown encoder with ffmpeg's message", async () => {
      let error;
      try {
        await transcode(ffmpeg, video, { format: "mp4", videoCodec: "no-such-encoder" });
      } catch (e) {
        error = e;
      }
      expect(error.message).to.match(/^transcode failed/).and.to.match(/no-such-encoder/);
      expect(await leftovers()).to.deep.equal([]);
    });

    it("stops after the timeout", async () => {
      let error;
      try {
        await transcode(ffmpeg, video, {
          format: "avi",
          timeout: 1,
          // An endless output, so only the timeout can end the run.
          args: ["-vf", "loop=loop=-1:size=1"],
        });
      } catch (e) {
        error = e;
      }
      expect(error.message).to.match(/exit code 1/);
      expect(await leftovers()).to.deep.equal([]);
    });
  });

  describe("extractFrames()", () => {
    it("returns png frames", async () => {
      const frames = await extractFrames(ffmpeg, video, { count: 3 });
      expect(frames).to.have.lengthOf(3);
      for (const frame of frames) expect(isPng(frame)).to.be.true;
      expect(await leftovers()).to.deep.equal([]);
    });

    it("keeps one frame per second and scales them", async () => {
      const frames = await extractFrames(ffmpeg, video, { fps: 1, width: 32 });
      expect(frames.length).to.be.within(1, 2);
      const stream = videoStream(await probe(ffmpeg, frames[0]));
      expect(stream.width).to.equal(32);
    });

    it("returns jpg frames", async () => {
      const [frame] = await extractFrames(ffmpeg, video, { format: "jpg", count: 1 });
      expect(frame[0]).to.equal(0xff);
      expect(frame[1]).to.equal(0xd8);
    });
  });
});
