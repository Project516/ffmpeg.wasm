let core;

const genName = (name) => `[ffmpeg-core][${FFMPEG_TYPE}] ${name}`;

const reset = () => {
  core.reset();
  core.setLogger(() => {});
  core.setProgress(() => {});
};

before(async () => {
  core = await createFFmpegCore();
  core.FS.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
});

describe(genName("createFFmpeg()"), () => {
  it("should be OK", () => {
    expect(core).to.be.ok;
  });
});

describe(genName("reset()"), () => {
  beforeEach(reset);

  it("should exist", () => {
    expect("reset" in core).to.be.true;
  });
  it("should reset ret and timeout", () => {
    core.ret = 1024;
    core.timeout = 1024;

    core.reset();

    expect(core.ret).to.equal(-1);
    expect(core.timeout).to.equal(-1);
  });
});

describe(genName("exec()"), () => {
  beforeEach(reset);

  it("should exist", () => {
    expect("exec" in core).to.be.true;
  });

  it("should output help", () => {
    expect(core.exec("-h")).to.equal(0);
  });

  it("should transcode", () => {
    expect(core.exec("-i", "video.mp4", "video.avi")).to.equal(0);
    const out = core.FS.readFile("video.avi");
    expect(out.length).to.not.equal(0);
    core.FS.unlink("video.avi");
  });
});

const probe = (file) => {
  core.ffprobe(
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    file,
    "-o", "probe.json"
  );
  const json = JSON.parse(new TextDecoder().decode(core.FS.readFile("probe.json")));
  core.FS.unlink("probe.json");
  return json;
};

describe(genName("remux, merge and audio extraction"), () => {
  before(() => {
    reset();
    expect(
      core.exec("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", "audio.m4a")
    ).to.equal(0);
    expect(
      core.exec("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", "audio.opus")
    ).to.equal(0);
    expect(
      core.exec("-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10", "-c:v", "libvpx", "video.webm")
    ).to.equal(0);
  });
  beforeEach(reset);

  it("should report streams as json with ffprobe", () => {
    const { streams, format } = probe("video.mp4");
    expect(streams.map((s) => s.codec_type)).to.deep.equal(["video"]);
    expect(parseFloat(format.duration)).to.be.greaterThan(0);
  });

  ["mkv", "mp4"].forEach((ext) => {
    it(`should remux with -c copy to ${ext}`, () => {
      const out = `remux.${ext}`;
      expect(core.exec("-i", "video.mp4", "-c", "copy", out)).to.equal(0);
      expect(probe(out).streams[0].codec_name).to.equal("h264");
      core.FS.unlink(out);
    });

    it(`should merge video and audio with -c copy into ${ext}`, () => {
      const out = `merged.${ext}`;
      expect(
        core.exec("-i", "video.mp4", "-i", "audio.m4a", "-map", "0:v", "-map", "1:a", "-c", "copy", out)
      ).to.equal(0);
      const types = probe(out).streams.map((s) => s.codec_type).sort();
      expect(types).to.deep.equal(["audio", "video"]);
      core.FS.unlink(out);
    });
  });

  it("should merge video and audio with -c copy into webm", () => {
    expect(
      core.exec("-i", "video.webm", "-i", "audio.opus", "-map", "0:v", "-map", "1:a", "-c", "copy", "merged.webm")
    ).to.equal(0);
    const types = probe("merged.webm").streams.map((s) => s.codec_type).sort();
    expect(types).to.deep.equal(["audio", "video"]);
    core.FS.unlink("merged.webm");
  });

  [
    ["mp3", "libmp3lame", "mp3"],
    ["m4a", "aac", "aac"],
    ["opus", "libopus", "opus"],
  ].forEach(([ext, encoder, codec]) => {
    it(`should extract audio as ${ext}`, () => {
      const out = `extracted.${ext}`;
      expect(core.exec("-i", "audio.m4a", "-vn", "-c:a", encoder, out)).to.equal(0);
      expect(probe(out).streams[0].codec_name).to.equal(codec);
      core.FS.unlink(out);
    });
  });
});

describe(genName("exec() after a failure"), () => {
  beforeEach(reset);

  it("should transcode after an exec that fails", () => {
    expect(core.exec("-i", "missing.mp4", "missing.avi")).to.not.equal(0);
    expect(core.exec("-i", "video.mp4", "video.avi")).to.equal(0);
    core.FS.unlink("video.avi");
  });
});

describe(genName("setTimeout()"), () => {
  beforeEach(reset);

  it("should exist", () => {
    expect("setTimeout" in core).to.be.true;
  });

  // -re paces input at its native rate, so the job outlasts the timeout.
  it("should timeout", () => {
    core.setTimeout(1); // timeout after 1ms
    expect(core.exec("-re", "-i", "video.mp4", "video.avi")).to.equal(1);
  });
});

describe(genName("exec() argv"), () => {
  beforeEach(reset);

  // ffmpeg reads argv[argc] when the last argument is an option, so it must be
  // NULL. Fill every allocation exec() makes with a bad pointer to catch a
  // missing terminator, which otherwise depends on what the heap held before.
  it("should end argv with NULL", () => {
    const malloc = core._malloc;
    core._malloc = (size) => {
      const ptr = malloc(size + 16);
      for (let i = 0; i < size + 16; i += 4) core.setValue(ptr + i, 0x7ffffff0, "i32");
      return ptr;
    };
    try {
      expect(core.exec("-h")).to.equal(0);
    } finally {
      core._malloc = malloc;
    }
  });
});

describe(genName("exec() after a timeout"), () => {
  beforeEach(reset);

  it("should run again after repeated timeouts", () => {
    for (let i = 0; i < 5; i++) {
      core.setTimeout(1);
      expect(core.exec("-re", "-i", "video.mp4", "video.avi")).to.equal(1);
      core.reset();
      expect(core.exec("-h")).to.equal(0);
      expect(core.exec("-i", "video.mp4", "video.avi")).to.equal(0);
      core.FS.unlink("video.avi");
    }
  });
});

describe(genName("setLogger()"), () => {
  beforeEach(reset);

  it("should exist", () => {
    expect("setLogger" in core).to.be.true;
  });

  it("should handle logs", () => {
    const logs = [];
    core.setLogger(({ message }) => logs.push(message));
    core.exec("-h");
    expect(logs.length).to.not.equal(0);
  });
});

describe(genName("locateFile()"), () => {
  afterEach(() => {
    delete core.mainScriptUrlOrBlob;
  });

  it("should use the wasmURL in the hash for the wasm file", () => {
    const hash = btoa(JSON.stringify({ wasmURL: "https://wasm.test/a.wasm" }));
    core.mainScriptUrlOrBlob = `https://core.test/ffmpeg-core.js#${hash}`;
    expect(core.locateFile("ffmpeg-core.wasm", "https://core.test/")).to.equal("https://wasm.test/a.wasm");
  });

  it("should not read the hash for other files", () => {
    core.mainScriptUrlOrBlob = "https://core.test/ffmpeg-core.js#not-base64";
    expect(core.locateFile("ffmpeg-core.data", "https://core.test/")).to.equal("https://core.test/ffmpeg-core.data");
  });

  it("should fall back to the prefix without a hash", () => {
    core.mainScriptUrlOrBlob = "https://core.test/ffmpeg-core.js";
    expect(core.locateFile("ffmpeg-core.wasm", "https://core.test/")).to.equal("https://core.test/ffmpeg-core.wasm");
  });
});

describe(genName("setProgress()"), () => {
  beforeEach(reset);

  it("should exist", () => {
    expect("setProgress" in core).to.be.true;
  });

  it("should handle progress", () => {
    let progress = 0;
    core.setProgress(({ progress: _progress }) => (progress = _progress));
    expect(core.exec("-i", "video.mp4", "video.avi")).to.equal(0);
    expect(progress).to.equal(1);
    core.FS.unlink("video.avi");
  });
});
