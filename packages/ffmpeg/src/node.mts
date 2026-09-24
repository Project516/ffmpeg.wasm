// Node.js entry point, selected by the "node" condition in package.json.
// Runs the worker code in a `worker_threads` Worker instead of a browser
// Worker; the public API is otherwise identical to the browser build.
import { Worker as NodeWorker } from "node:worker_threads";
import type { TransferListItem } from "node:worker_threads";
import { FFmpeg as FFmpegBase, WorkerLike } from "./classes.js";

const createNodeWorker = (url: URL): WorkerLike => {
  // classes.ts always computes the browser worker.js URL when the caller
  // does not pass a custom `classWorkerURL` (needed so webpack can find and
  // bundle the literal "./worker.js" specifier). Swap in the Node worker
  // entry that ships alongside it, sitting in the same directory. A caller
  // that does pass a custom classWorkerURL is trusted to point at a script
  // that speaks the same protocol under Node.
  const entryURL = url.pathname.endsWith("/worker.js") ?
    new URL("./worker-node-entry.mjs", url) :
    url;

  const worker = new NodeWorker(entryURL);
  const adapter: WorkerLike = {
    // worker_threads' TransferListItem and the DOM's Transferable don't
    // overlap cleanly in TS's lib types; both only ever carry the
    // ArrayBuffer behind a Uint8Array here.
    postMessage: (message, transfer) =>
      worker.postMessage(
        message,
        transfer as unknown as TransferListItem[] | undefined
      ),
    terminate: () => {
      // FFmpeg.terminate() does not await; worker_threads.terminate()
      // returns a promise but nothing here needs to wait on shutdown.
      void worker.terminate();
    },
    onmessage: null,
    onerror: null,
  };

  worker.on("message", (data: unknown) => {
    adapter.onmessage?.({ data } as MessageEvent);
  });
  worker.on("error", (error: Error) => {
    adapter.onerror?.(error as unknown as ErrorEvent);
  });

  return adapter;
};

export class FFmpeg extends FFmpegBase {
  constructor() {
    super({ createWorker: createNodeWorker });
  }
}

export * from "./types.js";
export * from "./const.js";
