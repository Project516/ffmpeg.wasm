import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@project516/types";
import type {
  FFMessageLoadConfig,
  FFMessageExecData,
  FFMessageWriteFileData,
  FFMessageReadFileData,
  FFMessageDeleteFileData,
  FFMessageRenameData,
  FFMessageCreateDirData,
  FFMessageListDirData,
  FFMessageDeleteDirData,
  FFMessageMountData,
  FFMessageUnmountData,
  CallbackData,
  IsFirst,
  OK,
  ExitCode,
  FSNode,
  FileData,
  FFMessageData,
} from "./types.js";
import { FFMessageType } from "./const.js";
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED } from "./errors.js";

/**
 * How the core script is loaded differs between a browser worker (classic
 * `importScripts()` or a module `import()`) and a Node.js `worker_threads`
 * worker (always `import()`), so each entry point supplies its own.
 */
export interface CoreEnv {
  importCore: (coreURL: string) => Promise<FFmpegCoreModuleFactory>;
  /** Used when the caller does not pass a `coreURL` to `load()`. */
  defaultCoreURL: string;
}

/**
 * Message dispatcher shared by the browser worker (worker.ts) and the
 * Node.js worker entry (worker-node-entry.mts). Only how the core script is
 * imported and how messages are posted differ between the two; everything
 * else, loading the core, exec/ffprobe, and the filesystem calls, is
 * identical.
 */
export const createDispatcher = (
  env: CoreEnv,
  postMessage: (message: { type: FFMessageType; data?: CallbackData }) => void
) => {
  let ffmpeg: FFmpegCoreModule;

  const load = async ({
    coreURL: _coreURL,
    wasmURL: _wasmURL,
  }: FFMessageLoadConfig): Promise<IsFirst> => {
    const first = !ffmpeg;
    const coreURL = _coreURL || env.defaultCoreURL;
    const wasmURL = _wasmURL ? _wasmURL : coreURL.replace(/\.js$/, ".wasm");
    const createFFmpegCore = await env.importCore(coreURL);

    ffmpeg = await createFFmpegCore({
      // Fix `Overload resolution failed.` when using multi-threaded ffmpeg-core.
      // Encoded wasmURL in the URL as a hack to fix locateFile issue.
      mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}`,
    });
    ffmpeg.setLogger((data) => postMessage({ type: FFMessageType.LOG, data }));
    ffmpeg.setProgress((data) =>
      postMessage({ type: FFMessageType.PROGRESS, data })
    );
    return first;
  };

  const exec = ({ args, timeout = -1 }: FFMessageExecData): ExitCode => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.exec(...args);
    const ret = ffmpeg.ret;
    ffmpeg.reset();
    return ret;
  };

  const ffprobe = ({ args, timeout = -1 }: FFMessageExecData): ExitCode => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.ffprobe(...args);
    const ret = ffmpeg.ret;
    ffmpeg.reset();
    return ret;
  };

  const writeFile = ({ path, data }: FFMessageWriteFileData): OK => {
    ffmpeg.FS.writeFile(path, data);
    return true;
  };

  const readFile = ({ path, encoding }: FFMessageReadFileData): FileData =>
    ffmpeg.FS.readFile(path, { encoding });

  const deleteFile = ({ path }: FFMessageDeleteFileData): OK => {
    ffmpeg.FS.unlink(path);
    return true;
  };

  const rename = ({ oldPath, newPath }: FFMessageRenameData): OK => {
    ffmpeg.FS.rename(oldPath, newPath);
    return true;
  };

  const createDir = ({ path }: FFMessageCreateDirData): OK => {
    ffmpeg.FS.mkdir(path);
    return true;
  };

  const listDir = ({ path }: FFMessageListDirData): FSNode[] => {
    const names = ffmpeg.FS.readdir(path);
    const nodes: FSNode[] = [];
    for (const name of names) {
      const stat = ffmpeg.FS.stat(`${path}/${name}`);
      const isDir = ffmpeg.FS.isDir(stat.mode);
      nodes.push({ name, isDir });
    }
    return nodes;
  };

  const deleteDir = ({ path }: FFMessageDeleteDirData): OK => {
    ffmpeg.FS.rmdir(path);
    return true;
  };

  const mount = ({ fsType, options, mountPoint }: FFMessageMountData): OK => {
    const str = fsType as keyof typeof ffmpeg.FS.filesystems;
    const fs = ffmpeg.FS.filesystems[str];
    if (!fs) return false;
    ffmpeg.FS.mount(fs, options, mountPoint);
    return true;
  };

  const unmount = ({ mountPoint }: FFMessageUnmountData): OK => {
    ffmpeg.FS.unmount(mountPoint);
    return true;
  };

  return async (
    type: FFMessageType,
    data: FFMessageData | undefined
  ): Promise<CallbackData> => {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;

    switch (type) {
      case FFMessageType.LOAD:
        return load((data ?? {}) as FFMessageLoadConfig);
      case FFMessageType.EXEC:
        return exec(data as FFMessageExecData);
      case FFMessageType.FFPROBE:
        return ffprobe(data as FFMessageExecData);
      case FFMessageType.WRITE_FILE:
        return writeFile(data as FFMessageWriteFileData);
      case FFMessageType.READ_FILE:
        return readFile(data as FFMessageReadFileData);
      case FFMessageType.DELETE_FILE:
        return deleteFile(data as FFMessageDeleteFileData);
      case FFMessageType.RENAME:
        return rename(data as FFMessageRenameData);
      case FFMessageType.CREATE_DIR:
        return createDir(data as FFMessageCreateDirData);
      case FFMessageType.LIST_DIR:
        return listDir(data as FFMessageListDirData);
      case FFMessageType.DELETE_DIR:
        return deleteDir(data as FFMessageDeleteDirData);
      case FFMessageType.MOUNT:
        return mount(data as FFMessageMountData);
      case FFMessageType.UNMOUNT:
        return unmount(data as FFMessageUnmountData);
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE; // eslint-disable-line @typescript-eslint/no-unsafe-argument
    }
  };
};
