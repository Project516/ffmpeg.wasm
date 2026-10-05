export const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
export const ERROR_NOT_LOADED = new Error(
  "ffmpeg is not loaded, call `await ffmpeg.load()` first"
);
export const ERROR_TERMINATED = new Error("called FFmpeg.terminate()");
export const ERROR_IMPORT_FAILURE = new Error(
  "failed to import ffmpeg-core.js"
);
export const ERROR_WORKER = new Error(
  "worker encountered an error, this is most likely caused by the worker script failing to load (CORP, network error, 404, etc.)"
);

// V8 words a non-wasm response "expected magic word 00 61 73 6d"; the core
// does not say which URL it fetched.
export const wasmLoadError = (wasmURL: string, e: unknown): unknown =>
  /magic word|WebAssembly\.(compile|instantiate)/i.test(String(e))
    ? new Error(`${wasmURL} is not a WebAssembly file (${String(e)})`, {
        cause: e,
      })
    : e;
