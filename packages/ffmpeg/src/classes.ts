import { FFMessageType } from "./const.js";
import {
  CallbackData,
  Callbacks,
  FSNode,
  FFMessageEventCallback,
  FFMessageLoadConfig,
  OK,
  IsFirst,
  LogEvent,
  Message,
  ProgressEvent,
  LogEventCallback,
  ProgressEventCallback,
  FileData,
  FFFSType,
  FFFSMountOptions,
  FFFSPath,
} from "./types.js";
import { getMessageID } from "./utils.js";
import { ERROR_TERMINATED, ERROR_NOT_LOADED, ERROR_WORKER } from "./errors.js";

declare const __FFMPEG_WORKER_TYPE__: WorkerType;

// Set by webpack's DefinePlugin for the UMD build; falls back to "module"
// for the ESM build, which runs as-is with no bundling step.
const WORKER_TYPE: WorkerType =
  typeof __FFMPEG_WORKER_TYPE__ === "undefined" ? "module" : __FFMPEG_WORKER_TYPE__;

type FFMessageOptions = {
  signal?: AbortSignal;
};

type EventListenerMethod = {
  (event: "log", callback: LogEventCallback): void;
  (event: "progress", callback: ProgressEventCallback): void;
};

/**
 * Provides APIs to interact with ffmpeg web worker.
 *
 * @example
 * ```ts
 * const ffmpeg = new FFmpeg();
 * ```
 */
export class FFmpeg {
  #worker: Worker | null = null;
  /**
   * #resolves and #rejects tracks Promise resolves and rejects to
   * be called when we receive message from web worker.
   */
  #resolves: Callbacks = {};
  #rejects: Callbacks = {};

  #logEventCallbacks: LogEventCallback[] = [];
  #progressEventCallbacks: ProgressEventCallback[] = [];

  public loaded = false;

  /**
   * register worker message event handlers.
   */
  #registerHandlers = () => {
    if (this.#worker) {
      this.#worker.onmessage = ({
        data: { id, type, data },
      }: FFMessageEventCallback) => {
        switch (type) {
          case FFMessageType.LOAD:
            this.loaded = true;
            this.#resolves[id](data);
            break;
          case FFMessageType.MOUNT:
          case FFMessageType.UNMOUNT:
          case FFMessageType.EXEC:
          case FFMessageType.FFPROBE:
          case FFMessageType.OPEN:
          case FFMessageType.READ:
          case FFMessageType.WRITE:
          case FFMessageType.CLOSE:
          case FFMessageType.WRITE_FILE:
          case FFMessageType.READ_FILE:
          case FFMessageType.DELETE_FILE:
          case FFMessageType.RENAME:
          case FFMessageType.CREATE_DIR:
          case FFMessageType.LIST_DIR:
          case FFMessageType.DELETE_DIR:
            this.#resolves[id](data);
            break;
          case FFMessageType.LOG:
            this.#logEventCallbacks.forEach((f) => f(data as LogEvent));
            break;
          case FFMessageType.PROGRESS:
            this.#progressEventCallbacks.forEach((f) =>
              f(data as ProgressEvent)
            );
            break;
          case FFMessageType.ERROR:
            this.#rejects[id](data);
            break;
        }
        delete this.#resolves[id];
        delete this.#rejects[id];
      };
      this.#worker.onerror = (event) => {
        const rejects = { ...this.#rejects };
        this.#rejects = {};
        this.#resolves = {};
        this.#worker?.terminate();
        this.#worker = null;
        this.loaded = false;
        // event.message is empty for a script that failed to load (the
        // network-error/404 case ERROR_WORKER already describes) but has
        // the real detail when the worker parsed and threw, so surface it
        // when present instead of only the generic message.
        const detail = event?.message;
        const error = detail ?
          new Error(`${ERROR_WORKER.message}: ${detail}`) :
          ERROR_WORKER;
        for (const reject of Object.values(rejects)) {
          reject(error);
        }
      };
    }
  };

  /**
   * Generic function to send messages to web worker.
   */
  #send = (
    { type, data }: Message,
    trans: Transferable[] = [],
    signal?: AbortSignal
  ): Promise<CallbackData> => {
    if (!this.#worker) {
      return Promise.reject(ERROR_NOT_LOADED);
    }

    return new Promise((resolve, reject) => {
      const id = getMessageID();
      this.#worker?.postMessage({ id, type, data }, trans);

      const onAbort = () => {
        reject(new DOMException(`Message # ${id} was aborted`, "AbortError"));
      };
      // Drop the abort listener once the message settles, so it does not
      // stay attached for the lifetime of a long-lived signal.
      this.#resolves[id] = (data) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(data);
      };
      this.#rejects[id] = (data) => {
        signal?.removeEventListener("abort", onAbort);
        // Worker errors arrive as strings, and callers catch them as is.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(data);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  /**
   * Listen to log or progress events from `ffmpeg.exec()`.
   *
   * @example
   * ```ts
   * ffmpeg.on("log", ({ type, message }) => {
   *   // ...
   * })
   * ```
   *
   * @example
   * ```ts
   * ffmpeg.on("progress", ({ progress, time }) => {
   *   // ...
   * })
   * ```
   *
   * @remarks
   * - log includes output to stdout and stderr.
   * - The progress events are accurate only when the length of
   * input and output video/audio file are the same.
   *
   * @category FFmpeg
   */
  // Arrow fields reach the #private fields when called through a Proxy such
  // as Vue's reactive(); prototype methods would throw a TypeError.
  public on: EventListenerMethod = (event, callback) => {
    if (event === "log") {
      this.#logEventCallbacks.push(callback as LogEventCallback);
    } else if (event === "progress") {
      this.#progressEventCallbacks.push(callback as ProgressEventCallback);
    }
  };

  /**
   * Unlisten to log or progress events from `ffmpeg.exec()`.
   *
   * @category FFmpeg
   */
  public off: EventListenerMethod = (event, callback) => {
    if (event === "log") {
      this.#logEventCallbacks = this.#logEventCallbacks.filter(
        (f) => f !== callback
      );
    } else if (event === "progress") {
      this.#progressEventCallbacks = this.#progressEventCallbacks.filter(
        (f) => f !== callback
      );
    }
  };

  /**
   * Loads ffmpeg-core inside web worker. It is required to call this method first
   * as it initializes WebAssembly and other essential variables.
   *
   * Calling it again on a loaded instance keeps the loaded core and resolves
   * `false`. Call `terminate()` first to load a different core.
   *
   * @category FFmpeg
   * @returns `true` if ffmpeg core is loaded for the first time.
   */
  public load = (
    { classWorkerURL, ...config }: FFMessageLoadConfig = {},
    { signal }: FFMessageOptions = {}
  ): Promise<IsFirst> => {
    if (!this.#worker) {
      this.#worker = classWorkerURL ?
        new Worker(new URL(classWorkerURL, import.meta.url), {
          type: WORKER_TYPE,
        }) :
        // We need to duplicated the code here to enable webpack
        // to bundle worker.js here.
        new Worker(new URL("./worker.js", import.meta.url), {
          type: WORKER_TYPE,
        });
      this.#registerHandlers();
    }
    return this.#send(
      {
        type: FFMessageType.LOAD,
        data: config,
      },
      undefined,
      signal
    ) as Promise<IsFirst>;
  };

  /**
   * Execute ffmpeg command.
   *
   * @remarks
   * To avoid common I/O issues, ["-nostdin", "-y"] are prepended to the args
   * by default.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * await ffmpeg.writeFile("video.avi", ...);
   * // ffmpeg -i video.avi video.mp4
   * await ffmpeg.exec(["-i", "video.avi", "video.mp4"]);
   * const data = ffmpeg.readFile("video.mp4");
   * ```
   *
   * @remarks
   * When `signal` aborts, the promise rejects with an `AbortError`. If
   * `SharedArrayBuffer` is available (cross-origin isolated pages, always on
   * Node.js) the running command also stops, the way a timeout stops it, and
   * the worker is free for the next call. Otherwise the command keeps running
   * in the worker and later calls wait for it to finish.
   *
   * @returns `0` if no error, `!= 0` if timeout (1) or error.
   * @category FFmpeg
   */
  public exec = (
    /** ffmpeg command line args */
    args: string[],
    /**
     * milliseconds to wait before stopping the command execution.
     *
     * @defaultValue -1
     */
    timeout = -1,
    { signal }: FFMessageOptions = {}
  ): Promise<number> => {
    // The worker is busy running the command, so the signal reaches it through
    // shared memory the core polls. Without SharedArrayBuffer (pages that are
    // not cross-origin isolated) an abort only rejects the promise.
    const canShare =
      typeof SharedArrayBuffer !== "undefined" &&
      (globalThis.crossOriginIsolated ?? true);
    const abortFlag =
      signal && canShare ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
    const stop = () => {
      if (abortFlag) Atomics.store(abortFlag, 0, 1);
    };
    signal?.addEventListener("abort", stop, { once: true });
    return (
      this.#send(
        {
          type: FFMessageType.EXEC,
          data: { args, timeout, abortFlag },
        },
        undefined,
        signal
      ) as Promise<number>
    ).finally(() => signal?.removeEventListener("abort", stop));
  };

  /**
   * Execute ffprobe command.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * await ffmpeg.writeFile("video.avi", ...);
   * // Getting duration of a video in seconds: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.avi -o output.txt
   * await ffmpeg.ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "video.avi", "-o", "output.txt"]);
   * const data = ffmpeg.readFile("output.txt");
   * ```
   *
   * @returns `0` if no error, `!= 0` if timeout (1) or error.
   * @category FFmpeg
   */
  public ffprobe = (
    /** ffprobe command line args */
    args: string[],
    /**
     * milliseconds to wait before stopping the command execution.
     *
     * @defaultValue -1
     */
    timeout = -1,
    { signal }: FFMessageOptions = {}
  ): Promise<number> =>
    this.#send(
      {
        type: FFMessageType.FFPROBE,
        data: { args, timeout },
      },
      undefined,
      signal
    ) as Promise<number>;

  /**
   * Terminate all ongoing API calls and terminate web worker.
   * `FFmpeg.load()` must be called again before calling any other APIs.
   *
   * @category FFmpeg
   */
  public terminate = (): void => {
    const ids = Object.keys(this.#rejects);
    // rejects all incomplete Promises.
    for (const id of ids) {
      this.#rejects[id](ERROR_TERMINATED);
      delete this.#rejects[id];
      delete this.#resolves[id];
    }

    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
      this.loaded = false;
    }
  };

  /**
   * Write data to ffmpeg.wasm.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * await ffmpeg.writeFile("video.avi", await fetchFile("../video.avi"));
   * await ffmpeg.writeFile("text.txt", "hello world");
   * ```
   *
   * @remarks
   * A `Uint8Array` is transferred to the worker without a copy, which leaves
   * it empty in the caller. Pass `{ transfer: false }` to copy it instead.
   *
   * @category File System
   */
  public writeFile = (
    path: string,
    data: FileData,
    { signal, transfer = true }: FFMessageOptions & { transfer?: boolean } = {}
  ): Promise<OK> => {
    const trans: Transferable[] = [];
    if (transfer && data instanceof Uint8Array) {
      trans.push(data.buffer);
    }
    return this.#send(
      {
        type: FFMessageType.WRITE_FILE,
        data: { path, data },
      },
      trans,
      signal
    ) as Promise<OK>;
  };

  /**
   * Open a file to read or write it in chunks. `flags` are Node.js-style:
   * "r", "r+", "w", "w+", "a", "a+". Resolves to a file descriptor for
   * read(), write() and close().
   *
   * @example
   * ```ts
   * const fd = await ffmpeg.open("input.mp4", "w");
   * for await (const chunk of response.body) await ffmpeg.write(fd, chunk);
   * await ffmpeg.close(fd);
   * ```
   *
   * @remarks
   * This writes into the in-memory file system. `exec()` still reads its
   * input from there once the file is complete.
   *
   * @category File System
   */
  public open = (
    path: string,
    flags: string,
    { signal }: FFMessageOptions = {}
  ): Promise<number> =>
    this.#send(
      { type: FFMessageType.OPEN, data: { path, flags } },
      undefined,
      signal
    ) as Promise<number>;

  /**
   * Read up to `length` bytes from `position`, or from where the last read or
   * write ended. Resolves to the bytes read: fewer than `length`, and empty
   * at the end of the file. A read at `position` does not move the file
   * offset.
   *
   * @category File System
   */
  public read = (
    fd: number,
    length: number,
    position?: number,
    { signal }: FFMessageOptions = {}
  ): Promise<Uint8Array> =>
    this.#send(
      { type: FFMessageType.READ, data: { fd, length, position } },
      undefined,
      signal
    ) as Promise<Uint8Array>;

  /**
   * Write `data` at `position`, or where the last read or write ended.
   * Resolves to the number of bytes written. A write at `position` does not
   * advance the file offset by the bytes written. On a descriptor opened
   * with "a" or "a+", every write first moves the offset to the end of the
   * file, so a write without `position` appends.
   *
   * @remarks
   * Like writeFile(), `data` is transferred to the worker, which leaves it
   * empty in the caller. Pass `{ transfer: false }` to copy it instead.
   *
   * @category File System
   */
  public write = (
    fd: number,
    data: Uint8Array,
    position?: number,
    { signal, transfer = true }: FFMessageOptions & { transfer?: boolean } = {}
  ): Promise<number> =>
    this.#send(
      { type: FFMessageType.WRITE, data: { fd, data, position } },
      transfer ? [data.buffer] : [],
      signal
    ) as Promise<number>;

  /**
   * Close a file opened with open(). The descriptor is invalid afterwards.
   *
   * @category File System
   */
  public close = (
    fd: number,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> =>
    this.#send(
      { type: FFMessageType.CLOSE, data: { fd } },
      undefined,
      signal
    ) as Promise<OK>;

  public mount = (fsType: FFFSType, options: FFFSMountOptions, mountPoint: FFFSPath, ): Promise<OK> => {
    const trans: Transferable[] = [];
    return this.#send(
      {
        type: FFMessageType.MOUNT,
        data: { fsType, options, mountPoint },
      },
      trans
    ) as Promise<OK>;
  };

  public unmount = (mountPoint: FFFSPath): Promise<OK> => {
    const trans: Transferable[] = [];
    return this.#send(
      {
        type: FFMessageType.UNMOUNT,
        data: { mountPoint },
      },
      trans
    ) as Promise<OK>;
  };

  /**
   * Read data from ffmpeg.wasm.
   *
   * @example
   * ```ts
   * const ffmpeg = new FFmpeg();
   * await ffmpeg.load();
   * const data = await ffmpeg.readFile("video.mp4");
   * ```
   *
   * @category File System
   */
  public readFile = (
    path: string,
    /**
     * File content encoding, supports two encodings:
     * - utf8: read file as text file, return data in string type.
     * - binary: read file as binary file, return data in Uint8Array type.
     *
     * @defaultValue binary
     */
    encoding = "binary",
    { signal }: FFMessageOptions = {}
  ): Promise<FileData> =>
    this.#send(
      {
        type: FFMessageType.READ_FILE,
        data: { path, encoding },
      },
      undefined,
      signal
    ) as Promise<FileData>;

  /**
   * Delete a file.
   *
   * @category File System
   */
  public deleteFile = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> =>
    this.#send(
      {
        type: FFMessageType.DELETE_FILE,
        data: { path },
      },
      undefined,
      signal
    ) as Promise<OK>;

  /**
   * Rename a file or directory.
   *
   * @category File System
   */
  public rename = (
    oldPath: string,
    newPath: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> =>
    this.#send(
      {
        type: FFMessageType.RENAME,
        data: { oldPath, newPath },
      },
      undefined,
      signal
    ) as Promise<OK>;

  /**
   * Create a directory.
   *
   * @category File System
   */
  public createDir = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> =>
    this.#send(
      {
        type: FFMessageType.CREATE_DIR,
        data: { path },
      },
      undefined,
      signal
    ) as Promise<OK>;

  /**
   * List directory contents.
   *
   * @category File System
   */
  public listDir = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<FSNode[]> =>
    this.#send(
      {
        type: FFMessageType.LIST_DIR,
        data: { path },
      },
      undefined,
      signal
    ) as Promise<FSNode[]>;

  /**
   * Delete an empty directory.
   *
   * @category File System
   */
  public deleteDir = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> =>
    this.#send(
      {
        type: FFMessageType.DELETE_DIR,
        data: { path },
      },
      undefined,
      signal
    ) as Promise<OK>;
}
