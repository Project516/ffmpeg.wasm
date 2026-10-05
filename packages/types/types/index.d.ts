// TODO: Add lint and test.

export type Pointer = number;

export type StringPointer = Pointer;
export type StringArrayPointer = Pointer;
export type DateString = string;

/**
 * Options for readFile.
 *
 * @see [Emscripten File System API](https://emscripten.org/docs/api_reference/Filesystem-API.html#FS.readFile)
 * @category File System
 */
export interface ReadFileOptions {
  /** encoding of the file, must be `binary` or `utf8` */
  encoding: string;
}

/**
 * Describes attributes of a node. (a.k.a file, directory)
 *
 * @see [Emscripten File System API](https://emscripten.org/docs/api_reference/Filesystem-API.html#FS.stat)
 * @category File System
 */
export interface Stat {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  atime: DateString;
  mtime: DateString;
  ctime: DateString;
  blksize: number;
  blocks: number;
}

export interface FSFilesystemWORKERFS {}

export interface FSFilesystemMEMFS {}

export interface FSFilesystems {
  WORKERFS: FSFilesystemWORKERFS;
  MEMFS: FSFilesystemMEMFS;
}

export type FSFilesystem = FSFilesystemWORKERFS | FSFilesystemMEMFS;

export interface OptionReadFile {
  encoding: string;
}

export interface WorkerFSMountConfig {
  blobs?: {
    name: string;
    data: Blob;
  }[];
  files?: File[];
}

/**
 * Functions to interact with Emscripten FS library.
 *
 * @see [Emscripten File System API](https://emscripten.org/docs/api_reference/Filesystem-API.html)
 * @category File System
 */
export interface FS {
  mkdir: (path: string) => void;
  rmdir: (path: string) => void;
  rename: (oldPath: string, newPath: string) => void;
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (path: string, opts: OptionReadFile) => Uint8Array | string;
  readdir: (path: string) => string[];
  unlink: (path: string) => void;
  stat: (path: string) => Stat;
  /** mode is a numeric notation of permission, @see [Numeric Notation](https://en.wikipedia.org/wiki/File-system_permissions#Numeric_notation) */
  isFile: (mode: number) => boolean;
  /** mode is a numeric notation of permission, @see [Numeric Notation](https://en.wikipedia.org/wiki/File-system_permissions#Numeric_notation) */
  isDir: (mode: number) => boolean;
  mount: (
    fileSystemType: FSFilesystem,
    data: WorkerFSMountConfig,
    path: string
  ) => void;
  unmount: (path: string) => void;
  filesystems: FSFilesystems;
}

/**
 * Arguments passed to setLogger callback function.
 */
export interface Log {
  /** file descriptor of the log, must be `stdout` or `stderr` */
  type: string;
  message: string;
}

/**
 * Arguments passed to setProgress callback function.
 */
export interface Progress {
  /** progress of the operation, interval = [0, 1] */
  progress: number;
  /** time of transcoded media in microseconds, ex: if a video is 10 seconds long, when time is 1000000 means 1 second of the video is transcoded already. */
  time: number;
}

/**
 * FFmpeg core module, an object to interact with ffmpeg.
 */
export interface FFmpegCoreModule {
  /** default arguments prepend when running exec() */
  DEFAULT_ARGS: string[];
  FS: FS;
  NULL: Pointer;
  SIZE_I32: number;

  /** return code of the ffmpeg exec, error when ret != 0 */
  ret: number;
  timeout: number;
  mainScriptUrlOrBlob: string;

  exec: (...args: string[]) => number;
  ffprobe: (...args: string[]) => number;
  reset: () => void;
  setLogger: (logger: (log: Log) => void) => void;
  setTimeout: (timeout: number) => void;
  setProgress: (handler: (progress: Progress) => void) => void;

  locateFile: (path: string, prefix: string) => string;
}

/**
 * Factory of FFmpegCoreModule.
 */
export type FFmpegCoreModuleFactory = (
  moduleOverrides?: Partial<FFmpegCoreModule>
) => Promise<FFmpegCoreModule>;

/**
 * Media accepted by the helpers in `@project516/ffmpeg-wasm` (`probe()`,
 * `transcode()`, `extractFrames()`). A `Uint8Array` is copied, so the
 * caller's buffer stays usable.
 *
 * @category Helpers
 */
export type MediaInput = File | Blob | URL | Uint8Array;

/**
 * Options shared by the helpers.
 *
 * @category Helpers
 */
export interface HelperOptions {
  /** Rejects the helper's promise when aborted. The running ffmpeg command is not interrupted, use `timeout` for that. */
  signal?: AbortSignal;
  /** Milliseconds before ffmpeg stops the command. Defaults to no limit. */
  timeout?: number;
}

/**
 * One stream in a {@link ProbeResult}. Values are as ffprobe prints them,
 * so numbers such as `duration` are strings. Fields vary by stream type.
 *
 * @category Helpers
 */
export interface ProbeStream {
  index: number;
  codec_type?: "video" | "audio" | "subtitle" | "data" | "attachment" | string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  sample_fmt?: string;
  channels?: number;
  channel_layout?: string;
  time_base?: string;
  start_time?: string;
  duration?: string;
  bit_rate?: string;
  nb_frames?: string;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Container information in a {@link ProbeResult}, as ffprobe prints it.
 *
 * @category Helpers
 */
export interface ProbeFormat {
  filename: string;
  nb_streams: number;
  format_name: string;
  format_long_name?: string;
  start_time?: string;
  /** Seconds, as a string. */
  duration?: string;
  /** Bytes, as a string. */
  size?: string;
  bit_rate?: string;
  probe_score?: number;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Result of `probe()`: ffprobe's `-show_format -show_streams` JSON.
 *
 * @category Helpers
 */
export interface ProbeResult {
  format: ProbeFormat;
  streams: ProbeStream[];
}

/**
 * Options for `transcode()`.
 *
 * @category Helpers
 */
export interface TranscodeOptions extends HelperOptions {
  /** Output container, as a file extension: `mp4`, `webm`, `mp3`, `wav`, `gif`, and so on. */
  format: string;
  /** Video encoder, for example `libx264` or `libvpx-vp9`. */
  videoCodec?: string;
  /** Audio encoder, for example `aac` or `libopus`. */
  audioCodec?: string;
  /** Bits per second, or a string such as `"500k"`. */
  videoBitrate?: number | string;
  /** Bits per second, or a string such as `"128k"`. */
  audioBitrate?: number | string;
  /** Output width in pixels. When only one of `width` and `height` is given, the other keeps the aspect ratio. */
  width?: number;
  height?: number;
  /** Output frame rate. */
  fps?: number;
  /** Output audio sample rate in Hz. */
  sampleRate?: number;
  /** Output audio channel count. */
  channels?: number;
  /** Seconds to skip at the start of the input. */
  start?: number;
  /** Seconds of output to write. */
  duration?: number;
  /** Drop the video stream. */
  noVideo?: boolean;
  /** Drop the audio stream. */
  noAudio?: boolean;
  /** Extra ffmpeg output options, placed before the output file. */
  args?: string[];
  onProgress?: (event: Progress) => void;
}

/**
 * Options for `extractFrames()`.
 *
 * @category Helpers
 */
export interface ExtractFramesOptions extends HelperOptions {
  /** Image format. Defaults to `png`. `webp` needs a core with libwebp. */
  format?: "png" | "jpg" | "webp";
  /** Frames per second of input to keep. Defaults to every frame. */
  fps?: number;
  /** Stop after this many frames. */
  count?: number;
  /** Seconds to skip at the start of the input. */
  start?: number;
  /** Seconds of input to read. */
  duration?: number;
  /** Frame width in pixels. When only one of `width` and `height` is given, the other keeps the aspect ratio. */
  width?: number;
  height?: number;
}
