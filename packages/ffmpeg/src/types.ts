import type { FFMessageType } from "./const.js";

export type FFFSPath = string;

/**
 * ffmpeg-core loading configuration.
 */
export interface FFMessageLoadConfig {
  /**
   * `ffmpeg-core.js` URL.
   *
   * @defaultValue `CORE_JSPI_URL` on a runtime with JSPI, else `CORE_URL`.
   * Under Node.js, the installed `@project516/ffmpeg-wasm-core-jspi` or
   * `@project516/ffmpeg-wasm-core`.
   */
  coreURL?: string;
  /**
   * `ffmpeg-core.wasm` URL.
   *
   * @defaultValue `coreURL` with `.js` replaced by `.wasm`.
   */
  wasmURL?: string;
  /**
   * `ffmpeg-core.worker.js` URL.
   *
   * @deprecated Multi-threaded cores built with emsdk >= 3.1.68 fold the
   * pthread worker into the main core script, so there is no separate
   * worker.js to point at anymore. Accepted for backward compatibility but
   * has no effect.
   */
  workerURL?: string;
  /**
   * `ffmpeg.worker.js` URL. This worker is spawned when FFmpeg.load() is called, it is an essential worker and usually you don't need to update this config.
   *
   * Browser only: under Node.js, `load()` always runs the bundled
   * `worker_threads` entry and ignores this option.
   *
   * @ref: https://ffmpegwasm.netlify.app/docs/overview#architecture
   * @defaultValue `./worker.js`
   */
  classWorkerURL?: string;
  /**
   * Pthread workers the multithread core starts up front. A command that
   * needs more threads than the pool fails instead of hanging, because the
   * pool cannot grow while the browser's main thread is blocked. Peak
   * threads per command (1 s H.264 input, default `-threads`): remux 2,
   * VP9 encode 14, MPEG-4 16, scale 18, x265 19, x264 and VP9 outputs 21,
   * x265 and x264 outputs 26, three x264 outputs 28, two x265 outputs 31.
   *
   * Ignored by the single-thread and JSPI cores. Must be an integer of at
   * least 1.
   *
   * @defaultValue `32` on the multithread core.
   */
  pthreadPoolSize?: number;
}

export interface FFMessageExecData {
  args: string[];
  timeout?: number;
  /** Int32Array on a SharedArrayBuffer; the core stops the command once its first element is non-zero. */
  abortFlag?: Int32Array;
}

export interface FFMessageOpenData {
  path: FFFSPath;
  flags: string;
}

export interface FFMessageReadData {
  fd: number;
  length: number;
  position?: number;
}

export interface FFMessageWriteData {
  fd: number;
  data: Uint8Array;
  position?: number;
}

export interface FFMessageCloseData {
  fd: number;
}

export interface FFMessageWriteFileData {
  path: FFFSPath;
  data: FileData;
}

export interface FFMessageReadFileData {
  path: FFFSPath;
  encoding: string;
}

export interface FFMessageDeleteFileData {
  path: FFFSPath;
}

export interface FFMessageRenameData {
  oldPath: FFFSPath;
  newPath: FFFSPath;
}

export interface FFMessageCreateDirData {
  path: FFFSPath;
}

export interface FFMessageListDirData {
  path: FFFSPath;
}

/**
 * @remarks
 * Only deletes empty directory.
 */
export interface FFMessageDeleteDirData {
  path: FFFSPath;
}

export enum FFFSType {
  MEMFS = "MEMFS",
  NODEFS = "NODEFS",
  NODERAWFS = "NODERAWFS",
  IDBFS  = "IDBFS",
  WORKERFS = "WORKERFS",
  PROXYFS = "PROXYFS",
}

export type WorkerFSFileEntry =
  | File;

export interface WorkerFSBlobEntry {
  name: string;
  data: Blob;
}

export interface WorkerFSMountData {
  blobs?: WorkerFSBlobEntry[];
  files?: WorkerFSFileEntry[];
}

export type FFFSMountOptions =
  | WorkerFSMountData;

export interface FFMessageMountData {
  fsType: FFFSType;
  options: FFFSMountOptions;
  mountPoint: FFFSPath;
}

export interface FFMessageUnmountData {
  mountPoint: FFFSPath;
}

export type FFMessageData =
  | FFMessageLoadConfig
  | FFMessageExecData
  | FFMessageOpenData
  | FFMessageReadData
  | FFMessageWriteData
  | FFMessageCloseData
  | FFMessageWriteFileData
  | FFMessageReadFileData
  | FFMessageDeleteFileData
  | FFMessageRenameData
  | FFMessageCreateDirData
  | FFMessageListDirData
  | FFMessageDeleteDirData
  | FFMessageMountData
  | FFMessageUnmountData;

export interface Message {
  type: FFMessageType;
  data?: FFMessageData;
}

export interface FFMessage extends Message {
  id: number;
}

export interface FFMessageEvent extends MessageEvent {
  data: FFMessage;
}

export interface LogEvent {
  type: string;
  message: string;
}

export interface ProgressEvent {
  progress: number;
  time: number;
}

export type ExitCode = number;
export type ErrorMessage = string;
export type FileData = Uint8Array | string;
export type IsFirst = boolean;
export type OK = boolean;

export interface FSNode {
  name: string;
  isDir: boolean;
}

export type CallbackData =
  | FileData
  | ExitCode
  | ErrorMessage
  | LogEvent
  | ProgressEvent
  | IsFirst
  | OK // eslint-disable-line
  | Error
  | FSNode[]
  | undefined;

export interface Callbacks {
  [id: number | string]: (data: CallbackData) => void;
}

export type LogEventCallback = (event: LogEvent) => void;
export type ProgressEventCallback = (event: ProgressEvent) => void;

export interface FFMessageEventCallback {
  data: {
    id: number;
    type: FFMessageType;
    data: CallbackData;
  };
}
