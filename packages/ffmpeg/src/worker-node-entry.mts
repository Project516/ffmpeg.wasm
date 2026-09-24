// Node.js worker_threads entry point. Spawned by classes.ts's Node
// `createWorker` in place of the browser Worker used by worker.ts. Runs the
// same message dispatcher (worker-core.js), talking to the parent thread
// over `parentPort` instead of `postMessage`/`onmessage`.
import { parentPort } from "node:worker_threads";
import type { TransferListItem } from "node:worker_threads";
import type { FFmpegCoreModuleFactory } from "@project516/types";
import type { FFMessage, CallbackData } from "./types.js";
import { FFMessageType } from "./const.js";
import { createDispatcher } from "./worker-core.js";

if (!parentPort) {
  throw new Error(
    "ffmpeg.wasm's Node worker entry must run inside a worker_threads Worker"
  );
}

interface ImportedFFmpegCoreModuleFactory {
  default?: FFmpegCoreModuleFactory;
}

const importCore = async (
  coreURL: string
): Promise<FFmpegCoreModuleFactory> => {
  const mod = (await import(
    /* webpackIgnore: true */ coreURL
  )) as ImportedFFmpegCoreModuleFactory;
  const factory = mod.default;
  if (!factory) {
    throw new Error(`failed to import ffmpeg-core from ${coreURL}`);
  }
  return factory;
};

// `@project516/core` resolves relative to the consuming project's own
// node_modules, not this package, so a bare specifier is correct here.
const defaultCoreURL = import.meta.resolve("@project516/core");

const dispatch = createDispatcher(
  { importCore, defaultCoreURL },
  (message) => parentPort!.postMessage(message)
);

const handleMessage = async ({ id, type, data }: FFMessage): Promise<void> => {
  let result: CallbackData;
  try {
    result = await dispatch(type, data);
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
  void handleMessage(message);
});
