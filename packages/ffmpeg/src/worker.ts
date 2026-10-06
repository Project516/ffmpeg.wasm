/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@project516/ffmpeg-wasm-types";
import type {
  FFMessageEvent,
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
} from "./types";
import { CORE_URL, FFMessageType } from "./const.js";
import {
  ERROR_UNKNOWN_MESSAGE_TYPE,
  ERROR_NOT_LOADED,
  ERROR_IMPORT_FAILURE,
  wasmLoadError,
} from "./errors.js";

// Set by importScripts() of the UMD core, or assigned from the ESM core's
// default export.
declare global {
  var createFFmpegCore: FFmpegCoreModuleFactory | undefined;
}

interface ImportedFFmpegCoreModuleFactory {
  default: FFmpegCoreModuleFactory;
}

let ffmpeg: FFmpegCoreModule;
// Set while a load() is in flight or done; see load().
let loading: Promise<void> | null = null;

const doLoad = async ({
  coreURL: _coreURL,
  wasmURL: _wasmURL,
}: FFMessageLoadConfig): Promise<void> => {
  try {
    if (!_coreURL) _coreURL = CORE_URL;
    // when web worker type is `classic`.
    importScripts(_coreURL);
  } catch (importScriptsError) {
    try {
      // A UMD coreURL (default or caller-supplied) fails to parse as an ES
      // module; retry any /umd/ URL under /esm/ instead of only the
      // default CORE_URL. Re-defaulted here (already done above) because
      // TS can't carry the narrowing across the try/catch boundary.
      _coreURL = _coreURL || CORE_URL;
      if (_coreURL.includes("/umd/")) _coreURL = _coreURL.replace('/umd/', '/esm/');
      // when web worker type is `module`.
      self.createFFmpegCore = (
        (await import(
          /* @vite-ignore */ /* turbopackIgnore: true */ _coreURL
        )) as ImportedFFmpegCoreModuleFactory
      ).default;

      if (!self.createFFmpegCore) {
        throw ERROR_IMPORT_FAILURE;
      }
    } catch (importError) {
      // Either failure can be the real one: importScripts() for a bad URL in
      // a classic worker, import() in a module worker. The caller only sees
      // the message, so it names both.
      throw new Error(
        `${ERROR_IMPORT_FAILURE.message}: importScripts(): ${
          (importScriptsError as Error).message
        }; import(): ${(importError as Error).message}`,
        { cause: importError }
      );
    }
  }

  const coreURL = _coreURL;
  const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, ".wasm");

  const createFFmpegCore = self.createFFmpegCore;
  if (!createFFmpegCore) throw ERROR_IMPORT_FAILURE;
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
    self.postMessage({ type: FFMessageType.LOG, data })
  );
  ffmpeg.setProgress((data) =>
    self.postMessage({
      type: FFMessageType.PROGRESS,
      data,
    })
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
const queueCommand = <T>(run: () => Promise<T>): Promise<T> => {
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

// TODO: check if deletion works.
const deleteFile = ({ path }: FFMessageDeleteFileData): OK => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }: FFMessageRenameData): OK => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

// TODO: check if creation works.
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

// TODO: check if deletion works.
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

self.onmessage = async ({
  data: { id, type, data: _data },
}: FFMessageEvent): Promise<void> => {
  const trans = [];
  let data: CallbackData;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;

    // KEEP THIS SWITCH IN SYNC WITH worker-node-entry.mts's: both must
    // handle the same set of FFMessageType cases.
    switch (type) {
      case FFMessageType.LOAD:
        data = await load(_data as FFMessageLoadConfig);
        break;
      case FFMessageType.EXEC:
        data = await exec(_data as FFMessageExecData);
        break;
      case FFMessageType.FFPROBE:
        data = await ffprobe(_data as FFMessageExecData);
        break;
      case FFMessageType.OPEN:
        data = open(_data as FFMessageOpenData);
        break;
      case FFMessageType.READ:
        data = read(_data as FFMessageReadData);
        break;
      case FFMessageType.WRITE:
        data = write(_data as FFMessageWriteData);
        break;
      case FFMessageType.CLOSE:
        data = close(_data as FFMessageCloseData);
        break;
      case FFMessageType.WRITE_FILE:
        data = writeFile(_data as FFMessageWriteFileData);
        break;
      case FFMessageType.READ_FILE:
        data = readFile(_data as FFMessageReadFileData);
        break;
      case FFMessageType.DELETE_FILE:
        data = deleteFile(_data as FFMessageDeleteFileData);
        break;
      case FFMessageType.RENAME:
        data = rename(_data as FFMessageRenameData);
        break;
      case FFMessageType.CREATE_DIR:
        data = createDir(_data as FFMessageCreateDirData);
        break;
      case FFMessageType.LIST_DIR:
        data = listDir(_data as FFMessageListDirData);
        break;
      case FFMessageType.DELETE_DIR:
        data = deleteDir(_data as FFMessageDeleteDirData);
        break;
      case FFMessageType.MOUNT:
        data = mount(_data as FFMessageMountData);
        break;
      case FFMessageType.UNMOUNT:
        data = unmount(_data as FFMessageUnmountData);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: (e as Error).toString(),
    });
    return;
  }
  if (data instanceof Uint8Array) {
    trans.push(data.buffer);
  }
  self.postMessage({ id, type, data }, trans);
};
