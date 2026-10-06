// Node.js worker_threads entry point. node.mts points its Worker adapter
// at this file instead of the browser's worker.js. worker.ts is part of
// webpack's bundled browser worker chunk (see node.mts's header comment
// on why that chunk is fragile to touch), so the message dispatch below
// is kept as its own copy instead of importing from worker.ts.
import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@project516/ffmpeg-wasm-types";
import type {
  FFMessage,
  FFMessageLoadConfig,
  FFMessageExecData,
  FFMessageOpenData,
  FFMessageReadData,
  FFMessageWriteData,
  FFMessageCloseData,
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
import {
  ERROR_UNKNOWN_MESSAGE_TYPE,
  ERROR_NOT_LOADED,
  wasmLoadError,
} from "./errors.js";

if (!parentPort) {
  throw new Error(
    "ffmpeg.wasm's Node worker entry must run inside a worker_threads Worker"
  );
}

let ffmpeg: FFmpegCoreModule;
// Set while a load() is in flight or done; see load().
let loading: Promise<void> | null = null;

// `@project516/ffmpeg-wasm-core` resolves relative to the consuming
// project's own node_modules, not this package, so a bare specifier is
// correct here.
const defaultCoreURL = (): string => {
  try {
    return import.meta.resolve("@project516/ffmpeg-wasm-core");
  } catch (e) {
    // Unlike the browser, where @project516/ffmpeg-wasm-core loads from a
    // CDN by default, a Node.js consumer has to install it themselves (it
    // is not a dependency of this package). Surface that instead of the
    // raw ERR_MODULE_NOT_FOUND.
    throw new Error(
      "load() needs @project516/ffmpeg-wasm-core installed to resolve " +
        "the default coreURL under Node.js. Run `pnpm add " +
        "@project516/ffmpeg-wasm-core` (or `-core-mt` for the " +
        "multithread core), or pass coreURL explicitly.",
      { cause: e }
    );
  }
};

// Two or more scheme characters, so a Windows drive path like C:\x is a path
// and not a "c:" URL.
const toURL = (location: string): string =>
  /^[a-z][a-z0-9+.-]+:/i.test(location)
    ? location
    : pathToFileURL(location).href;

const doLoad = async ({
  coreURL: _coreURL,
  wasmURL: _wasmURL,
}: FFMessageLoadConfig): Promise<void> => {
  const coreURL = _coreURL ? toURL(_coreURL) : defaultCoreURL();
  const wasmURL = _wasmURL
    ? toURL(_wasmURL)
    : coreURL.replace(/\.js$/, ".wasm");

  if (coreURL.startsWith("blob:")) {
    // Node's ESM loader cannot import() a blob: URL (unlike fetch(), which
    // does accept one), so a coreURL built with toBlobURL() would fail
    // here with a confusing error. util/src/index.ts's toBlobURL() itself
    // stays Node-agnostic, since it works for a browser caller and for
    // wasmURL either way; this is the one place a blob: coreURL actually
    // cannot work.
    throw new Error(
      "coreURL cannot be a blob: URL under Node.js; pass the core's real " +
        "file:// path or package specifier instead."
    );
  }

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

  try {
    ffmpeg = await createFFmpegCore({
      // Fix `Overload resolution failed.` when using multi-threaded ffmpeg-core.
      // Encoded wasmURL in the URL as a hack to fix locateFile issue.
      mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}`,
    });
  } catch (e) {
    throw wasmLoadError(wasmURL, e);
  }
  ffmpeg.setLogger((data) =>
    parentPort!.postMessage({ type: FFMessageType.LOG, data })
  );
  ffmpeg.setProgress((data) =>
    parentPort!.postMessage({ type: FFMessageType.PROGRESS, data })
  );
};

// Only the call that starts the load reports true. Later calls wait for it
// and report false, so a second load() never creates a second core. A failed
// load clears the slot so the next call can retry.
const load = async (config: FFMessageLoadConfig): Promise<IsFirst> => {
  if (loading) {
    await loading;
    return false;
  }
  loading = doLoad(config);
  try {
    await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
  return true;
};

// The JSPI core returns a Promise from exec() and ffprobe(), and the worker
// then handles other messages while one runs. Commands are queued so they
// still run one at a time.
let lastCommand: Promise<unknown> = Promise.resolve();
const queueCommand = <T,>(run: () => Promise<T>): Promise<T> => {
  const next = lastCommand.then(run, run);
  lastCommand = next.catch(() => {});
  return next;
};

const exec = ({
  args,
  timeout = -1,
  abortFlag,
}: FFMessageExecData): Promise<ExitCode> =>
  queueCommand(async () => {
    ffmpeg.setTimeout(timeout);
    if (abortFlag) ffmpeg.setAbortFlag(abortFlag);
    try {
      await ffmpeg.exec(...args);
      return ffmpeg.ret;
    } finally {
      ffmpeg.reset();
    }
  });

const ffprobe = ({
  args,
  timeout = -1,
}: FFMessageExecData): Promise<ExitCode> =>
  queueCommand(async () => {
    ffmpeg.setTimeout(timeout);
    try {
      await ffmpeg.ffprobe(...args);
      return ffmpeg.ret;
    } finally {
      ffmpeg.reset();
    }
  });

const writeFile = ({ path, data }: FFMessageWriteFileData): OK => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const open = ({ path, flags }: FFMessageOpenData): number =>
  ffmpeg.FS.open(path, flags).fd;

const read = ({ fd, length, position }: FFMessageReadData): Uint8Array => {
  const stream = ffmpeg.FS.getStreamChecked(fd);
  // Allocate no more than the file holds, whatever length asks for.
  const left = ffmpeg.FS.fstat(fd).size - (position ?? stream.position);
  const buffer = new Uint8Array(Math.max(0, Math.min(length, left)));
  const count = ffmpeg.FS.read(stream, buffer, 0, buffer.length, position);
  return count === buffer.length ? buffer : buffer.slice(0, count);
};

const write = ({ fd, data, position }: FFMessageWriteData): number =>
  ffmpeg.FS.write(
    ffmpeg.FS.getStreamChecked(fd),
    data,
    0,
    data.length,
    position
  );

const close = ({ fd }: FFMessageCloseData): OK => {
  ffmpeg.FS.close(ffmpeg.FS.getStreamChecked(fd));
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
  if (!Object.hasOwn(ffmpeg.FS.filesystems, str)) return false;
  const fs = ffmpeg.FS.filesystems[str];
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
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;

    // KEEP THIS SWITCH IN SYNC WITH worker.ts's: both must handle the same
    // set of FFMessageType cases.
    switch (type) {
      case FFMessageType.LOAD:
        result = await load((data ?? {}) as FFMessageLoadConfig);
        break;
      case FFMessageType.EXEC:
        result = await exec(data as FFMessageExecData);
        break;
      case FFMessageType.FFPROBE:
        result = await ffprobe(data as FFMessageExecData);
        break;
      case FFMessageType.OPEN:
        result = open(data as FFMessageOpenData);
        break;
      case FFMessageType.READ:
        result = read(data as FFMessageReadData);
        break;
      case FFMessageType.WRITE:
        result = write(data as FFMessageWriteData);
        break;
      case FFMessageType.CLOSE:
        result = close(data as FFMessageCloseData);
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
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e) {
    parentPort!.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: (e as Error).toString(),
    });
    return;
  }
  // Uint8Array.buffer is typed ArrayBufferLike (it would also cover a
  // SharedArrayBuffer-backed view), but the FS reads that produce `result`
  // here always allocate a plain ArrayBuffer.
  const transferList = result instanceof Uint8Array ?
    [result.buffer as ArrayBuffer] :
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
