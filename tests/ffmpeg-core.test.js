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

describe(genName("state between calls"), () => {
  beforeEach(reset);

  const probeFormat = (...args) => {
    expect(core.ffprobe("-v", "error", "-print_format", "json", ...args, "video.mp4", "-o", "probe.json")).to.equal(0);
    const json = JSON.parse(new TextDecoder().decode(core.FS.readFile("probe.json")));
    core.FS.unlink("probe.json");
    return json;
  };

  it("should log after an exec with -loglevel quiet", () => {
    expect(core.exec("-loglevel", "quiet", "-i", "video.mp4", "quiet.avi")).to.equal(0);
    core.FS.unlink("quiet.avi");
    const logs = [];
    core.setLogger(({ message }) => logs.push(message));
    expect(core.exec("-i", "video.mp4", "loud.avi")).to.equal(0);
    core.FS.unlink("loud.avi");
    expect(logs.length).to.not.equal(0);
  });

  it("should log after an exec with -report", () => {
    expect(core.exec("-report", "-i", "video.mp4", "report.avi")).to.equal(0);
    core.FS.unlink("report.avi");
    for (const name of core.FS.readdir(".").filter((n) => /^ffmpeg-.*\.log$/.test(n))) {
      core.FS.unlink(name);
    }
    const logs = [];
    core.setLogger(({ message }) => logs.push(message));
    expect(core.exec("-i", "video.mp4", "loud.avi")).to.equal(0);
    core.FS.unlink("loud.avi");
    expect(logs.length).to.not.equal(0);
  });

  it("should not keep -show_entries in a later ffprobe", () => {
    const first = probeFormat("-show_entries", "format=duration");
    expect(first.format.duration).to.be.ok;
    expect(first.format.format_name).to.be.undefined;
    const second = probeFormat("-show_format");
    expect(second.format.format_name).to.be.ok;
  });

  it("should keep progress within 0 and 1 with -nostats", () => {
    const values = [];
    core.setProgress(({ progress }) => values.push(progress));
    expect(core.exec("-nostats", "-i", "video.mp4", "video.avi")).to.equal(0);
    core.FS.unlink("video.avi");
    expect(values.length).to.not.equal(0);
    for (const v of values) expect(v).to.be.within(0, 1);
    expect(values[values.length - 1]).to.equal(1);
  });

  it("should fail ffprobe on a missing file and probe again after", () => {
    expect(core.ffprobe("-v", "error", "missing.mp4")).to.not.equal(0);
    expect(core.ffprobe("-v", "error", "-show_format", "video.mp4", "-o", "probe.json")).to.equal(0);
    core.FS.unlink("probe.json");
  });
});

describe(genName("exec() repeated calls"), () => {
  beforeEach(reset);

  it("should produce identical output across runs", () => {
    const outputs = [];
    for (let i = 0; i < 5; i++) {
      expect(
        core.exec(
          "-f", "lavfi", "-i", "testsrc=d=0.3:s=32x24:r=10",
          "-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", "repeat.y4m"
        )
      ).to.equal(0);
      outputs.push(core.FS.readFile("repeat.y4m"));
      core.FS.unlink("repeat.y4m");
    }
    const [first, ...rest] = outputs;
    expect(first.length).to.not.equal(0);
    rest.forEach((out) => expect(out).to.deep.equal(first));
  });

  it("should not carry inputs and outputs over to the next run", () => {
    expect(core.exec("-f", "lavfi", "-i", "sine=d=0.2", "carry.wav")).to.equal(0);
    expect(core.exec("-f", "lavfi", "-i", "testsrc=d=0.2:s=16x16:r=5", "carry.mp4")).to.equal(0);
    expect(probe("carry.mp4").streams.map((s) => s.codec_type)).to.deep.equal(["video"]);
    core.FS.unlink("carry.wav");
    core.FS.unlink("carry.mp4");
  });
});

describe(genName("ffprobe() repeated calls"), () => {
  beforeEach(reset);

  const probeStreams = (...args) => {
    core.ffprobe("-v", "error", "-print_format", "json", ...args, "video.mp4", "-o", "probe.json");
    const json = JSON.parse(new TextDecoder().decode(core.FS.readFile("probe.json")));
    core.FS.unlink("probe.json");
    return json;
  };

  it("should not keep -select_streams in a later call", () => {
    expect(probeStreams("-show_streams", "-select_streams", "a").streams).to.have.lengthOf(0);
    expect(probeStreams("-show_streams").streams).to.have.lengthOf(1);
  });

  it("should keep working when calls alternate with exec()", () => {
    for (let i = 0; i < 3; i++) {
      expect(probeStreams("-show_format").format.nb_streams).to.equal(1);
      expect(core.exec("-f", "lavfi", "-i", "sine=d=0.1", "alt.wav")).to.equal(0);
      core.FS.unlink("alt.wav");
    }
  });
});

describe(genName("exec() exit codes"), () => {
  beforeEach(reset);

  const run = (...args) => {
    const logs = [];
    core.setLogger(({ message }) => logs.push(message));
    const ret = core.exec(...args);
    return { ret, log: logs.join("\n") };
  };

  it("should return non-zero for an unknown option", () => {
    const { ret, log } = run("-definitely-not-an-option");
    expect(ret).to.not.equal(0);
    expect(log).to.match(/Unrecognized option/);
  });

  it("should return non-zero when the input is missing", () => {
    const { ret, log } = run("-i", "missing.mp4", "missing.avi");
    expect(ret).to.not.equal(0);
    expect(log).to.match(/No such file or directory/);
  });

  it("should return non-zero for an unknown encoder", () => {
    const { ret } = run("-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.1", "-c:v", "no-such-encoder", "bad.mp4");
    expect(ret).to.not.equal(0);
  });

  it("should return non-zero when no output is given", () => {
    expect(run("-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.1").ret).to.not.equal(0);
  });

  it("should return the value left in core.ret", () => {
    expect(core.exec("-definitely-not-an-option")).to.equal(core.ret);
  });

  it("should not throw when an option is missing its argument", () => {
    expect(() => core.exec("-i")).to.not.throw();
  });
});

describe(genName("reset() handlers"), () => {
  it("should keep the logger and progress handlers", () => {
    const logger = () => {};
    const progress = () => {};
    core.setLogger(logger);
    core.setProgress(progress);
    core.reset();
    expect(core.logger).to.equal(logger);
    expect(core.progress).to.equal(progress);
    reset();
  });
});
