// Node.js entry point, selected by the "node" condition in package.json.
// classes.ts constructs its worker with a literal `new Worker(new
// URL(...), ...)` expression; webpack's WorkerPlugin pattern-matches on
// that exact shape to find and bundle worker.js, so classes.ts is not
// touched here (wrapping the call in an injected factory function broke
// that detection once already). Instead this polyfills the global `Worker`
// that expression resolves to, with an adapter backed by `worker_threads`,
// before classes.ts ever runs.
import { Worker as NodeWorker } from "node:worker_threads";
import type { TransferListItem } from "node:worker_threads";

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
      this.onmessage?.({ data } as MessageEvent);
    });
    this.#worker.on("error", (error: Error) => {
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
    // returns a promise but nothing here needs to wait on shutdown.
    void this.#worker.terminate();
  }
}

(globalThis as { Worker?: unknown }).Worker = NodeWorkerAdapter;

export { FFmpeg } from "./classes.js";
export * from "./types.js";
export * from "./const.js";
