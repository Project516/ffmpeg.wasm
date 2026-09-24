// Node.js worker_threads entry point. node.mts points its Worker adapter
// at this file instead of the browser's worker.js. worker.ts is part of
// webpack's bundled browser worker chunk (see node.mts's header comment
// on why that chunk is fragile to touch), so the message dispatch below
// is kept as its own copy instead of importing from worker.ts.
import { parentPort } from "node:worker_threads";
import type { TransferListItem } from "node:worker_threads";
import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@project516/ffmpeg-wasm-types";
import type {
  FFMessage,
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
} from "./types.js";
import { FFMessageType } from "./const.js";
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED } from "./errors.js";

if (!parentPort) {
  throw new Error(
    "ffmpeg.wasm's Node worker entry must run inside a worker_threads Worker"
  );
}

let ffmpeg: FFmpegCoreModule;

// `@project516/ffmpeg-wasm-core` resolves relative to the consuming
// project's own node_modules, not this package, so a bare specifier is
// correct here.
const defaultCoreURL = (): string =>
  import.meta.resolve("@project516/ffmpeg-wasm-core");

const load = async ({
  coreURL: _coreURL,
  wasmURL: _wasmURL,
}: FFMessageLoadConfig): Promise<IsFirst> => {
  const first = !ffmpeg;
  const coreURL = _coreURL || defaultCoreURL();
  const wasmURL = _wasmURL ? _wasmURL : coreURL.replace(/\.js$/, ".wasm");

  // This file is never reachable from index.js's import graph, so no
  // bundler magic comment is needed here the way util/src/index.ts needs
  // one for its shared, browser-reachable fs import.
  const mod = (await import(coreURL)) as {
    default?: FFmpegCoreModuleFactory;
  };
  const createFFmpegCore = mod.default;
  if (!createFFmpegCore) {
    throw new Error(`failed to import ffmpeg-core from ${coreURL}`);
  }

  ffmpeg = await createFFmpegCore({
    // Fix `Overload resolution failed.` when using multi-threaded ffmpeg-core.
    // Encoded wasmURL in the URL as a hack to fix locateFile issue.
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}`,
  });
  ffmpeg.setLogger((data) =>
    parentPort!.postMessage({ type: FFMessageType.LOG, data })
  );
  ffmpeg.setProgress((data) =>
    parentPort!.postMessage({ type: FFMessageType.PROGRESS, data })
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

const handleMessage = async ({ id, type, data }: FFMessage): Promise<void> => {
  let result: CallbackData;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED; // eslint-disable-line

    // KEEP THIS SWITCH IN SYNC WITH worker.ts's: both must handle the same
    // set of FFMessageType cases.
    switch (type) {
      case FFMessageType.LOAD:
        result = await load((data ?? {}) as FFMessageLoadConfig);
        break;
      case FFMessageType.EXEC:
        result = exec(data as FFMessageExecData);
        break;
      case FFMessageType.FFPROBE:
        result = ffprobe(data as FFMessageExecData);
        break;
      case FFMessageType.WRITE_FILE:
        result = writeFile(data as FFMessageWriteFileData);
        break;
      case FFMessageType.READ_FILE:
        result = readFile(data as FFMessageReadFileData);
        break;
      case FFMessageType.DELETE_FILE:
        result = deleteFile(data as FFMessageDeleteFileData);
        break;
      case FFMessageType.RENAME:
        result = rename(data as FFMessageRenameData);
        break;
      case FFMessageType.CREATE_DIR:
        result = createDir(data as FFMessageCreateDirData);
        break;
      case FFMessageType.LIST_DIR:
        result = listDir(data as FFMessageListDirData);
        break;
      case FFMessageType.DELETE_DIR:
        result = deleteDir(data as FFMessageDeleteDirData);
        break;
      case FFMessageType.MOUNT:
        result = mount(data as FFMessageMountData);
        break;
      case FFMessageType.UNMOUNT:
        result = unmount(data as FFMessageUnmountData);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE; // eslint-disable-line @typescript-eslint/no-unsafe-argument
    }
  } catch (e) {
    parentPort!.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: (e as Error).toString(),
    });
    return;
  }
  const transferList = result instanceof Uint8Array ?
    [result.buffer as unknown as TransferListItem] :
    [];
  parentPort!.postMessage({ id, type, data: result }, transferList);
};

parentPort.on("message", (message: FFMessage) => {
  // handleMessage() catches everything it can (including a failed core
  // load) and replies with an ERROR message, but a postMessage() call
  // itself throwing (e.g. a closed port) would otherwise be an unhandled
  // rejection.
  handleMessage(message).catch((e: unknown) => {
    console.error("ffmpeg.wasm worker failed to report a message:", e);
  });
});
