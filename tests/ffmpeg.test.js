const { FFmpeg, probe, transcode, extractFrames } = window.FFmpegWASM;

const genName = (name) => `[ffmpeg][${FFMPEG_TYPE}] ${name}`;

const createFFmpeg = async () => {
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: CORE_URL,
    thread: FFMPEG_TYPE === "mt",
  });
  return ffmpeg;
};

describe(genName("new FFmpeg()"), () => {
  it("should be OK", () => {
    expect(new FFmpeg()).to.be.ok;
  });
});

describe(genName("concurrent load()"), () => {
  it("resolves first=true for exactly one of two concurrent load() calls", async () => {
    const ffmpeg = new FFmpeg();
    const config = { coreURL: CORE_URL, thread: FFMPEG_TYPE === "mt" };
    try {
      const [a, b] = await Promise.all([
        ffmpeg.load(config),
        ffmpeg.load(config),
      ]);
      expect([a, b].filter(Boolean)).to.have.lengthOf(1);
    } finally {
      ffmpeg.terminate();
    }
  });
});

describe(
  genName(
    "FFmpeg directory APIs (createDir(), listDir(), deleteDir(), rename())"
  ),
  function () {
    let ffmpeg;

    before(async () => {
      ffmpeg = await createFFmpeg();
    });

    after(() => {
      ffmpeg.terminate();
    });

    it("should list root dir", async () => {
      const files = await ffmpeg.listDir("/");
      expect(files).to.have.lengthOf(6);
    });

    it("should create a dir", async () => {
      await ffmpeg.createDir("/dir1");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.include("dir1");
    });

    it("should delete a dir", async () => {
      await ffmpeg.createDir("/dir2");
      await ffmpeg.deleteDir("/dir2");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.not.include("dir2");
    });

    it("should rename a dir", async () => {
      await ffmpeg.createDir("/dir3");
      await ffmpeg.rename("/dir3", "/dir4");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.not.include("dir3");
      expect(files.map(({ name }) => name)).to.include("dir4");
    });
  }
);

describe(
  genName(
    "FFmpeg files APIs (readFile(), writeFile(), deleteFile(), rename())"
  ),
  function () {
    let ffmpeg;

    before(async () => {
      ffmpeg = await createFFmpeg();
    });

    after(() => {
      ffmpeg.terminate();
    });

    it("should write/read a text file", async () => {
      const text = "foo";
      await ffmpeg.writeFile("/file1", text);
      const data = await ffmpeg.readFile("/file1", "utf8");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.include("file1");
      expect(data).to.equal(text);
    });

    it("should write a binary file", async () => {
      const bin = [1, 2, 3];
      await ffmpeg.writeFile("/file2", Uint8Array.from(bin));
      const data = await ffmpeg.readFile("/file2");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.include("file2");
      expect(data).to.deep.equal(Uint8Array.from(bin));
    });
  }
);

describe(
  genName("FFmpeg chunked file APIs (open(), read(), write(), close())"),
  function () {
    let ffmpeg;

    before(async () => {
      ffmpeg = await createFFmpeg();
    });

    after(() => {
      ffmpeg.terminate();
    });

    it("should write in chunks and read the file back", async () => {
      const fd = await ffmpeg.open("/chunked1", "w");
      expect(await ffmpeg.write(fd, Uint8Array.from([1, 2, 3]))).to.equal(3);
      expect(await ffmpeg.write(fd, Uint8Array.from([4, 5]))).to.equal(2);
      await ffmpeg.close(fd);
      const data = await ffmpeg.readFile("/chunked1");
      expect(data).to.deep.equal(Uint8Array.from([1, 2, 3, 4, 5]));
    });

    it("should read with a length and an offset", async () => {
      await ffmpeg.writeFile("/chunked2", Uint8Array.from([1, 2, 3, 4, 5]));
      const fd = await ffmpeg.open("/chunked2", "r");
      expect(await ffmpeg.read(fd, 2)).to.deep.equal(Uint8Array.from([1, 2]));
      expect(await ffmpeg.read(fd, 2)).to.deep.equal(Uint8Array.from([3, 4]));
      expect(await ffmpeg.read(fd, 4, 1)).to.deep.equal(
        Uint8Array.from([2, 3, 4, 5])
      );
      expect(await ffmpeg.read(fd, 4, 5)).to.have.length(0);
      expect(await ffmpeg.read(fd, 2 ** 31, 3)).to.deep.equal(
        Uint8Array.from([4, 5])
      );
      await ffmpeg.close(fd);
    });

    it("should reject use of a closed file descriptor", async () => {
      const fd = await ffmpeg.open("/chunked3", "w");
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
    });

    it("should transfer written data unless transfer is false", async () => {
      const fd = await ffmpeg.open("/chunked4", "w");
      const kept = Uint8Array.from([1, 2]);
      await ffmpeg.write(fd, kept, undefined, { transfer: false });
      expect(kept.length).to.equal(2);
      const moved = Uint8Array.from([3, 4]);
      await ffmpeg.write(fd, moved);
      expect(moved.length).to.equal(0);
      await ffmpeg.close(fd);
      expect(await ffmpeg.readFile("/chunked4")).to.deep.equal(
        Uint8Array.from([1, 2, 3, 4])
      );
    });
  }
);

describe(genName("FFmpeg.exec()"), function () {
  let ffmpeg;

  before(async () => {
    ffmpeg = await createFFmpeg();
    await ffmpeg.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
  });

  after(() => {
    ffmpeg.terminate();
  });

  it("should output help with exit code 0", async () => {
    let m;
    const listener = ({ message }) => {
      m = message;
    };
    ffmpeg.on("log", listener);
    const ret = await ffmpeg.exec(["-h"]);
    expect(ret).to.equal(0);
    expect(m).to.be.a("string");
    ffmpeg.off("log", listener);
  });

  it("should transcode mp4 to avi", async () => {
    let p;
    const listener = ({ progress }) => {
      p = progress;
    };
    ffmpeg.on("progress", listener);
    const ret = await ffmpeg.exec(["-i", "video.mp4", "video.avi"]);
    expect(ret).to.equal(0);
    expect(p).to.equal(1);
    ffmpeg.off("progress", listener);
  });

  // -re paces input at its native rate, so the job outlasts the timeout.
  it("should stop if timeout", async () => {
    const ret = await ffmpeg.exec(["-re", "-i", "video.mp4", "video.avi"], 1);
    expect(ret).to.equal(1);
  });

  it("should abort", () => {
    const controller = new AbortController();
    const { signal } = controller;

    const promise = ffmpeg.exec(["-i", "video.mp4", "video.avi"], undefined, {
      signal,
    });
    controller.abort();

    return promise.catch((err) => {
      expect(err.name).to.equal("AbortError");
    });
  });
});

describe(genName("helpers (probe(), transcode(), extractFrames())"), function () {
  let ffmpeg;
  let video;

  before(async () => {
    ffmpeg = await createFFmpeg();
    video = b64ToUint8Array(VIDEO_1S_MP4);
  });

  after(() => {
    ffmpeg.terminate();
  });

  it("should probe a Blob and a File", async () => {
    for (const input of [new Blob([video]), new File([video], "clip.mp4")]) {
      const info = await probe(ffmpeg, input);
      expect(info.format.format_name).to.include("mp4");
      expect(info.streams.some((s) => s.codec_type === "video")).to.be.true;
    }
  });

  it("should transcode a Uint8Array and leave it usable", async () => {
    const out = await transcode(ffmpeg, video, { format: "avi" });
    expect(out.length).to.not.equal(0);
    expect(video.length).to.not.equal(0);
    const info = await probe(ffmpeg, out);
    expect(info.format.format_name).to.equal("avi");
  });

  it("should extract png frames", async () => {
    const frames = await extractFrames(ffmpeg, video, { count: 2 });
    expect(frames).to.have.lengthOf(2);
    expect(frames[0][1]).to.equal(0x50);
  });

  it("should leave no files behind", async () => {
    const names = (await ffmpeg.listDir("/")).map(({ name }) => name);
    expect(names.filter((n) => n.startsWith("ffmpeg-wasm-job-"))).to.deep.equal([]);
  });
});
