import type {
  ExtractFramesOptions,
  HelperOptions,
  MediaInput,
  ProbeResult,
  TranscodeOptions,
} from "@project516/ffmpeg-wasm-types";
import type { FFmpeg } from "./classes.js";
import type { LogEvent } from "./types.js";

export type {
  ExtractFramesOptions,
  HelperOptions,
  MediaInput,
  ProbeFormat,
  ProbeResult,
  ProbeStream,
  TranscodeOptions,
} from "@project516/ffmpeg-wasm-types";

/**
 * The part of {@link FFmpeg} the helpers use. Any loaded `FFmpeg`, including
 * the Node.js one, satisfies it.
 */
export type HelperFFmpeg = Pick<
  FFmpeg,
  | "exec"
  | "ffprobe"
  | "writeFile"
  | "readFile"
  | "deleteFile"
  | "createDir"
  | "deleteDir"
  | "listDir"
  | "on"
  | "off"
>;

const LOG_TAIL_LINES = 8;

let nextJob = 0;

const isNode = (): boolean =>
  typeof process !== "undefined" && process.versions?.node != null;

// webpackIgnore and @vite-ignore keep bundlers from resolving node:fs for the
// browser build; it is only reached for a file: URL under Node.js.
const NODE_FS_SPECIFIER = "node:fs/promises";

const readLocalFile = async (url: URL): Promise<Uint8Array> => {
  const fs = (await import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    NODE_FS_SPECIFIER
  )) as typeof import("node:fs/promises");
  return new Uint8Array(await fs.readFile(url));
};

const extensionOf = (name: string | undefined): string => {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? "");
  return match ? `.${match[1].toLowerCase()}` : "";
};

const readInput = async (
  input: MediaInput
): Promise<{ data: Uint8Array; ext: string }> => {
  if (input instanceof Uint8Array) {
    // writeFile() transfers the buffer to the worker, so hand it a copy.
    return { data: input.slice(), ext: "" };
  }
  if (input instanceof URL) {
    if (input.protocol === "file:" && isNode()) {
      return { data: await readLocalFile(input), ext: extensionOf(input.pathname) };
    }
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`could not fetch ${input.href}: HTTP ${response.status}`);
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      ext: extensionOf(input.pathname),
    };
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return {
      data: new Uint8Array(await input.arrayBuffer()),
      ext: extensionOf((input as File).name),
    };
  }
  throw new TypeError("input must be a File, Blob, URL or Uint8Array");
};

const positive = (name: string, value: number | undefined): void => {
  if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${name} must be a positive number`);
  }
};

const nonNegative = (name: string, value: number | undefined): void => {
  if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be zero or more`);
  }
};

const scaleFilter = (
  width: number | undefined,
  height: number | undefined
): string[] => {
  positive("width", width);
  positive("height", height);
  if (width === undefined && height === undefined) return [];
  // -2 keeps the aspect ratio and rounds to an even size, which most
  // encoders need.
  return [`scale=${width ?? -2}:${height ?? -2}`];
};

interface Job {
  dir: string;
  inputPath: string;
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Writes the input into a private directory of the virtual file system, runs
 * `run`, and removes everything it left there, even when `run` throws.
 */
const withJob = async <T>(
  ffmpeg: HelperFFmpeg,
  input: MediaInput,
  { signal, timeout }: HelperOptions,
  run: (job: Job) => Promise<T>
): Promise<T> => {
  nonNegative("timeout", timeout);
  const { data, ext } = await readInput(input);
  const dir = `/ffmpeg-wasm-job-${nextJob++}`;
  const job: Job = { dir, inputPath: `${dir}/input${ext}`, signal, timeout };
  await ffmpeg.createDir(dir, { signal });
  try {
    await ffmpeg.writeFile(job.inputPath, data, { signal });
    return await run(job);
  } finally {
    await removeDir(ffmpeg, dir);
  }
};

const removeDir = async (ffmpeg: HelperFFmpeg, dir: string): Promise<void> => {
  try {
    for (const { name, isDir } of await ffmpeg.listDir(dir)) {
      if (name === "." || name === ".." || isDir) continue;
      await ffmpeg.deleteFile(`${dir}/${name}`);
    }
    await ffmpeg.deleteDir(dir);
  } catch {
    // The worker may be gone (terminate(), a crash); nothing is left to clean.
  }
};

/** Collects the last few log lines of `run`, for error messages. */
const withLogTail = async <T>(
  ffmpeg: HelperFFmpeg,
  run: (tail: string[]) => Promise<T>
): Promise<T> => {
  const tail: string[] = [];
  const onLog = ({ message }: LogEvent) => {
    tail.push(message);
    if (tail.length > LOG_TAIL_LINES) tail.shift();
  };
  ffmpeg.on("log", onLog);
  try {
    return await run(tail);
  } finally {
    ffmpeg.off("log", onLog);
  }
};

const failure = (what: string, code: number, tail: string[]): Error =>
  new Error(
    `${what} failed (exit code ${code})${tail.length ? `:\n${tail.join("\n")}` : ""}`
  );

/**
 * Reads the container and stream information of a media file.
 *
 * @example
 * ```ts
 * const info = await probe(ffmpeg, file);
 * const video = info.streams.find((s) => s.codec_type === "video");
 * console.log(info.format.duration, video?.width, video?.height);
 * ```
 *
 * @category Helpers
 */
export const probe = (
  ffmpeg: HelperFFmpeg,
  input: MediaInput,
  options: HelperOptions = {}
): Promise<ProbeResult> =>
  withJob(ffmpeg, input, options, ({ dir, inputPath, signal, timeout }) =>
    withLogTail(ffmpeg, async (tail) => {
      const outputPath = `${dir}/probe.json`;
      const code = await ffmpeg.ffprobe(
        [
          "-v", "error",
          "-print_format", "json",
          "-show_format", "-show_streams",
          inputPath,
          "-o", outputPath,
        ],
        timeout,
        { signal }
      );
      // ffprobe's exit code is not reliable on success, so judge by the output.
      let result: ProbeResult | undefined;
      try {
        const json = await ffmpeg.readFile(outputPath, "utf8", { signal });
        result = JSON.parse(json as string) as ProbeResult;
      } catch {
        // handled below
      }
      if (!result?.format) throw failure("probe", code, tail);
      result.streams ??= [];
      return result;
    })
  );

/**
 * Converts a media file and returns the new file's bytes.
 *
 * @example
 * ```ts
 * const webm = await transcode(ffmpeg, file, {
 *   format: "webm",
 *   videoCodec: "libvpx-vp9",
 *   width: 640,
 * });
 * ```
 *
 * @category Helpers
 */
export const transcode = async (
  ffmpeg: HelperFFmpeg,
  input: MediaInput,
  options: TranscodeOptions
): Promise<Uint8Array> => {
  const { format } = options;
  if (typeof format !== "string" || !/^[A-Za-z0-9]{1,10}$/.test(format)) {
    throw new TypeError("format must be a file extension such as mp4 or webm");
  }
  positive("fps", options.fps);
  positive("sampleRate", options.sampleRate);
  positive("channels", options.channels);
  nonNegative("start", options.start);
  positive("duration", options.duration);
  const filters = scaleFilter(options.width, options.height);
  const before: string[] = options.start ? ["-ss", String(options.start)] : [];
  const after: string[] = [];
  if (options.noVideo) after.push("-vn");
  if (options.noAudio) after.push("-an");
  if (options.videoCodec) after.push("-c:v", options.videoCodec);
  if (options.audioCodec) after.push("-c:a", options.audioCodec);
  if (options.videoBitrate !== undefined) after.push("-b:v", String(options.videoBitrate));
  if (options.audioBitrate !== undefined) after.push("-b:a", String(options.audioBitrate));
  if (filters.length) after.push("-vf", filters.join(","));
  if (options.fps) after.push("-r", String(options.fps));
  if (options.sampleRate) after.push("-ar", String(options.sampleRate));
  if (options.channels) after.push("-ac", String(options.channels));
  if (options.duration) after.push("-t", String(options.duration));
  after.push(...(options.args ?? []));

  return withJob(ffmpeg, input, options, ({ dir, inputPath, signal, timeout }) =>
    withLogTail(ffmpeg, async (tail) => {
      const outputPath = `${dir}/output.${format.toLowerCase()}`;
      const { onProgress } = options;
      if (onProgress) ffmpeg.on("progress", onProgress);
      let code: number;
      try {
        code = await ffmpeg.exec(
          [...before, "-i", inputPath, ...after, outputPath],
          timeout,
          { signal }
        );
      } finally {
        if (onProgress) ffmpeg.off("progress", onProgress);
      }
      if (code !== 0) throw failure("transcode", code, tail);
      return (await ffmpeg.readFile(outputPath, "binary", { signal })) as Uint8Array;
    })
  );
};

/**
 * Decodes a video and returns its frames as encoded images, in order.
 * Frames are held in memory, so limit long videos with `fps`, `count`,
 * `start` and `duration`.
 *
 * @example
 * ```ts
 * const frames = await extractFrames(ffmpeg, file, { fps: 1, width: 320 });
 * const url = URL.createObjectURL(new Blob([frames[0]], { type: "image/png" }));
 * ```
 *
 * @category Helpers
 */
export const extractFrames = async (
  ffmpeg: HelperFFmpeg,
  input: MediaInput,
  options: ExtractFramesOptions = {}
): Promise<Uint8Array[]> => {
  const format = options.format ?? "png";
  if (!["png", "jpg", "webp"].includes(format)) {
    throw new TypeError("format must be png, jpg or webp");
  }
  positive("fps", options.fps);
  positive("count", options.count);
  nonNegative("start", options.start);
  positive("duration", options.duration);
  const filters = scaleFilter(options.width, options.height);
  if (options.fps) filters.unshift(`fps=${options.fps}`);
  const before: string[] = options.start ? ["-ss", String(options.start)] : [];
  const after: string[] = ["-an"];
  if (options.duration) after.push("-t", String(options.duration));
  if (filters.length) after.push("-vf", filters.join(","));
  if (options.count) after.push("-frames:v", String(Math.floor(options.count)));
  if (format === "jpg") after.push("-q:v", "2");

  return withJob(ffmpeg, input, options, ({ dir, inputPath, signal, timeout }) =>
    withLogTail(ffmpeg, async (tail) => {
      const code = await ffmpeg.exec(
        [...before, "-i", inputPath, ...after, `${dir}/frame-%06d.${format}`],
        timeout,
        { signal }
      );
      if (code !== 0) throw failure("extractFrames", code, tail);
      const names = (await ffmpeg.listDir(dir, { signal }))
        .map(({ name }) => name)
        .filter((name) => name.startsWith("frame-"))
        .sort();
      const frames: Uint8Array[] = [];
      for (const name of names) {
        frames.push((await ffmpeg.readFile(`${dir}/${name}`, "binary", { signal })) as Uint8Array);
      }
      return frames;
    })
  );
};
