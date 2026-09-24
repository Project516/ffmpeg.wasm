// Node.js entry point, selected by the "node" condition in package.json.
// classes.ts must keep the literal `new Worker(new URL(...), ...)`
// expression in load(); webpack's WorkerPlugin detects the worker entry
// (worker.js) from that exact shape, so classes.ts is not touched here.
// Instead, FFmpeg below installs a `worker_threads`-backed adapter as the
// global `Worker` that expression resolves to, but only for the duration
// of load()'s synchronous setup (it constructs `this.#worker` before any
// `await`), so the rest of the process never observes a global `Worker`.
import { Worker as NodeWorker } from "node:worker_threads";
import type { TransferListItem } from "node:worker_threads";
import { FFmpeg as FFmpegBase } from "./classes.js";
import type { FFMessageLoadConfig } from "./types.js";

class NodeWorkerAdapter {
  #worker: NodeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  // classes.ts always passes a WorkerOptions second argument ({ type }),
  // which only matters for a real browser Worker; nothing here reads it.
  constructor(url: URL) {
    // classes.ts always computes the browser worker.js URL when the caller
    // does not pass a custom `classWorkerURL`. Swap in the Node worker
    // entry that ships alongside it, in the same directory. A caller that
    // does pass a custom classWorkerURL is trusted to point at a script
    // that speaks the same protocol under Node.
    const entryURL = url.pathname.endsWith("/worker.js") ?
      new URL("./worker-node-entry.mjs", url) :
      url;

    this.#worker = new NodeWorker(entryURL);
    this.#worker.on("message", (data: unknown) => {
      // classes.ts's onmessage handler only reads `.data` off this object;
      // a real MessageEvent's other fields (origin, ports, ...) have no
      // Node worker_threads equivalent and are never read.
      this.onmessage?.({ data } as MessageEvent);
    });
    this.#worker.on("error", (error: Error) => {
      // classes.ts's onerror handler only reads `.message`, which a plain
      // Error has too, so this stands in for the browser's ErrorEvent
      // without needing a real one.
      this.onerror?.(error as unknown as ErrorEvent);
    });
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    // worker_threads' TransferListItem and the DOM's Transferable don't
    // overlap cleanly in TS's lib types; both only ever carry the
    // ArrayBuffer behind a Uint8Array here.
    this.#worker.postMessage(
      message,
      transfer as unknown as TransferListItem[] | undefined
    );
  }

  terminate(): void {
    // FFmpeg.terminate() does not await; worker_threads.terminate()
    // returns a promise but nothing here needs to wait on shutdown. The
    // catch is only there so a failed shutdown doesn't surface as an
    // unhandled rejection; there's nothing more useful to do with it here.
    this.#worker.terminate().catch(() => {});
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
