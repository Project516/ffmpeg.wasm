/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { FFmpegCoreModuleFactory } from "@project516/ffmpeg-wasm-types";
import type { FFMessageEvent, CallbackData } from "./types.js";
import { CORE_URL, FFMessageType } from "./const.js";
import { createDispatcher } from "./worker-core.js";
import { ERROR_IMPORT_FAILURE } from "./errors.js";

declare global {
  interface WorkerGlobalScope {
    createFFmpegCore: FFmpegCoreModuleFactory;
  }
}

interface ImportedFFmpegCoreModuleFactory {
  default: FFmpegCoreModuleFactory;
}

const importCore = async (
  coreURL: string
): Promise<FFmpegCoreModuleFactory> => {
  try {
    // when web worker type is `classic`.
    importScripts(coreURL);
    return (self as WorkerGlobalScope).createFFmpegCore;
  } catch (importScriptsError) {
    try {
      const esmURL =
        coreURL === CORE_URL ? CORE_URL.replace("/umd/", "/esm/") : coreURL;
      // when web worker type is `module`.
      const factory = (
        (await import(
          /* @vite-ignore */ esmURL
        )) as ImportedFFmpegCoreModuleFactory
      ).default;

      if (!factory) throw ERROR_IMPORT_FAILURE;
      return factory;
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
};

const dispatch = createDispatcher(
  { importCore, defaultCoreURL: CORE_URL },
  (message) => self.postMessage(message)
);

self.onmessage = async ({
  data: { id, type, data },
}: FFMessageEvent): Promise<void> => {
  let result: CallbackData;
  try {
    result = await dispatch(type, data);
  } catch (e) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: (e as Error).toString(),
    });
    return;
  }
  const trans = result instanceof Uint8Array ? [result.buffer] : [];
  self.postMessage({ id, type, data: result }, trans);
};
