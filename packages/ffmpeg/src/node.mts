// Node.js entry point, selected by the "node" condition in package.json.
// classes.ts must keep the literal `new Worker(new URL(...), ...)`
// expression in load(); webpack's WorkerPlugin detects the worker entry
// (worker.js) from that exact shape, so classes.ts is not touched here.
// Instead, FFmpeg below installs a `worker_threads`-backed adapter as the
// global `Worker` that expression resolves to, but only for the duration
// of load()'s synchronous setup (it constructs `this.#worker` before any
// `await`), so the rest of the process never observes a global `Worker`.
import { Worker as NodeWorker } from "node:worker_threads";
import { FFmpeg as FFmpegBase } from "./classes.js";
import type { FFMessageLoadConfig } from "./types.js";

// classes.ts's onmessage/onerror handlers only read `.data` and `.message`
// off the browser's MessageEvent/ErrorEvent, so NodeWorkerAdapter declares
// just that much instead of the full DOM event shape, and builds plain
// objects for it rather than casting a worker_threads value to a DOM type
// it never actually is.
type MinimalMessageEvent = { data: unknown };
type MinimalErrorEvent = { message: string };

class NodeWorkerAdapter {
  #worker: NodeWorker;
  onmessage: ((event: MinimalMessageEvent) => void) | null = null;
  onerror: ((event: MinimalErrorEvent) => void) | null = null;

  // classes.ts always passes a WorkerOptions second argument ({ type }),
  // which only matters for a real browser Worker; nothing here reads it.
  // The URL classes.ts computed (the default worker.js, or a caller's
  // `classWorkerURL`) is ignored too: `classWorkerURL` is a browser-only
  // option (see its doc comment in types.ts), so Node always runs the
  // bundled worker-node-entry.mjs that ships alongside this file.
  constructor() {
    const entryURL = new URL("./worker-node-entry.mjs", import.meta.url);
    this.#worker = new NodeWorker(entryURL);
    this.#worker.on("message", (data: unknown) => {
      this.onmessage?.({ data });
    });
    this.#worker.on("error", (error: Error) => {
      this.onerror?.({ message: error.message });
    });
    // The vendored fftools C sources call the C library's exit() directly
    // on some error paths instead of going through the wrapper that turns
    // a stop into a caught abort(); that kills the whole worker thread,
    // which worker_threads reports as "exit", not "error". Without this,
    // FFmpeg.load()/exec() would hang forever waiting for a message that
    // will never come.
    this.#worker.on("exit", (code: number) => {
      if (code !== 0) {
        this.onerror?.({
          message: `the Node worker exited with code ${code}`,
        });
      }
    });
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    // Only ArrayBuffer (via Uint8Array.buffer) is ever actually sent here.
    // Filtering to it, rather than casting the whole list, means a
    // MessagePort or other DOM-only Transferable is dropped instead of
    // being handed to worker_threads, which does not accept it.
    const transferList = transfer?.filter(
      (t): t is ArrayBuffer => t instanceof ArrayBuffer
    );
    this.#worker.postMessage(message, transferList);
  }

  terminate(): void {
    // FFmpeg.terminate() does not await; worker_threads.terminate()
    // returns a promise but nothing here needs to wait on shutdown. The
    // catch logs rather than swallowing the error outright, so a failed
    // shutdown is visible somewhere instead of only avoiding an unhandled
    // rejection.
    this.#worker.terminate().catch((e: unknown) => {
      console.error("ffmpeg.wasm: failed to terminate the Node worker:", e);
    });
  }
}

type GlobalWithWorker = Omit<typeof globalThis, "Worker"> & {
  Worker?: unknown;
};

export class FFmpeg extends FFmpegBase {
  constructor() {
    super();
    const baseLoad = this.load;
    // Narrow the window the global `Worker` polyfill exists in to just
    // this call: classes.ts's load() is a plain (non-async) function that
    // constructs `this.#worker` before returning, with no `await` in that
    // path, so the whole install-construct-restore sequence below runs in
    // one synchronous turn and two `load()` calls can never interleave.
    // If classes.ts's load() ever became async before constructing the
    // worker, this window would need to move with it.
    this.load = ((
      config?: FFMessageLoadConfig,
      options?: Parameters<typeof baseLoad>[1]
    ) => {
      const global = globalThis as GlobalWithWorker;
      const hadWorker = "Worker" in global;
      const previousWorker = global.Worker;
      global.Worker = NodeWorkerAdapter;
      try {
        return baseLoad(config, options);
      } finally {
        if (hadWorker) {
          global.Worker = previousWorker;
        } else {
          delete global.Worker;
        }
      }
    });
  }
}

export * from "./types.js";
export * from "./const.js";
