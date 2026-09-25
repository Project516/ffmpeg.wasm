/**
 * Constants
 */

const NULL = 0;
const SIZE_I32 = Uint32Array.BYTES_PER_ELEMENT;
const DEFAULT_ARGS = ["./ffmpeg", "-nostdin", "-y"];
const DEFAULT_ARGS_FFPROBE = ["./ffprobe"];

Module["NULL"] = NULL;
Module["SIZE_I32"] = SIZE_I32;
Module["DEFAULT_ARGS"] = DEFAULT_ARGS;
Module["DEFAULT_ARGS_FFPROBE"] = DEFAULT_ARGS_FFPROBE;

/**
 * Variables
 */

Module["ret"] = -1;
Module["timeout"] = -1;
Module["logger"] = () => {};
Module["progress"] = () => {};

/*
 * Emscripten calls Module.onAbort synchronously, before throwing the
 * exception that unwinds the call. av_log (which feeds Module.logger)
 * would otherwise be the only way to see why abort() was called (e.g. a
 * failed av_assert0), but logger is a no-op unless a caller sets one, so a
 * silent abort deep inside a call is otherwise invisible. This always goes
 * to console.error, independent of Module.logger.
 */
Module["onAbort"] = (what) => {
  try {
    console.error("[ffmpeg.wasm] onAbort:", what);
  } catch {
    // best effort; never let a diagnostic hook itself throw
  }
};

/**
 * Functions
 */

function stringToPtr(str) {
  const len = Module["lengthBytesUTF8"](str) + 1;
  const ptr = Module["_malloc"](len);
  Module["stringToUTF8"](str, ptr, len);

  return ptr;
}

function stringsToPtr(strs) {
  const len = strs.length;
  const ptr = Module["_malloc"](len * SIZE_I32);
  for (let i = 0; i < len; i++) {
    Module["setValue"](ptr + SIZE_I32 * i, stringToPtr(strs[i]), "i32");
  }

  return ptr;
}

function print(message) {
  Module["logger"]({ type: "stdout", message });
}

function printErr(message) {
  if (!message.startsWith("Aborted(native code called abort())"))
    Module["logger"]({ type: "stderr", message });
}

function freeArgs(argc, argvPtr) {
  for (let i = 0; i < argc; i++) {
    Module["_free"](Module["getValue"](argvPtr + SIZE_I32 * i, "i32"));
  }
  Module["_free"](argvPtr);
}

/**
 * ffmpeg and ffprobe finish by calling exit(), which Emscripten implements by
 * throwing. That exception unwinds the JavaScript frames, but nothing
 * unwinds the WebAssembly stack, so the stack pointer is left wherever the C
 * code happened to leave it and every call permanently consumes a little
 * more of the stack. Saving it before the call and restoring it in a
 * `finally` is what Emscripten's own invoke_* helpers do for exactly this
 * situation (ffmpegwasm/ffmpeg.wasm#943).
 *
 * The argv strings and the argv pointer array built by stringsToPtr() are a
 * second, independent leak: nothing ever freed them, so repeated exec()/
 * ffprobe() calls slowly exhaust the heap on top of the stack leak above.
 */
function exec(..._args) {
  const args = [...Module["DEFAULT_ARGS"], ..._args];
  const argc = args.length;
  const sp = stackSave();
  const argvPtr = stringsToPtr(args);
  try {
    Module["_ffmpeg"](argc, argvPtr);
  } catch (e) {
    if (!e.message.startsWith("Aborted")) {
      throw e;
    }
  } finally {
    freeArgs(argc, argvPtr);
    stackRestore(sp);
  }
  return Module["ret"];
}

function ffprobe(..._args) {
  const args = [...Module["DEFAULT_ARGS_FFPROBE"], ..._args];
  const argc = args.length;
  const sp = stackSave();
  const argvPtr = stringsToPtr(args);
  try {
    Module["_ffprobe"](argc, argvPtr);
  } catch (e) {
    if (!e.message.startsWith("Aborted")) {
      throw e;
    }
  } finally {
    freeArgs(argc, argvPtr);
    stackRestore(sp);
  }
  return Module["ret"];
}

function setLogger(logger) {
  Module["logger"] = logger;
}

function setTimeout(timeout) {
  Module["timeout"] = timeout;
}

function setProgress(handler) {
  Module["progress"] = handler;
}

function receiveProgress(progress, time) {
  Module["progress"]({ progress, time });
}

function reset() {
  Module["ret"] = -1;
  Module["timeout"] = -1;
}

/**
 * When ffmpeg-core.js and ffmpeg-core.wasm are served from different
 * locations (e.g. a Blob URL for the JS, a CDN URL for the wasm), Emscripten
 * has no way to know the custom wasm URL on its own.
 *
 * The hack here is leveraging mainScriptUrlOrBlob by adding wasmURL in
 * base64 format as a hash fragment. ex:
 *
 *   http://example.com/ffmpeg-core.js#{btoa(JSON.stringify({"wasmURL": "..."}))}
 *
 * Thus, we can successfully extract the custom URL using _locateFile.
 *
 * The multi-threaded core used to need the same trick for a companion
 * ffmpeg-core.worker.js, spawned by ffmpeg-core.js to run pthreads. emsdk
 * >= 3.1.68 folds that worker into the main core script, so there is no
 * separate worker.js file to locate anymore.
 */
function _locateFile(path, prefix) {
  const mainScriptUrlOrBlob = Module["mainScriptUrlOrBlob"];
  if (mainScriptUrlOrBlob) {
    const { wasmURL } = JSON.parse(
      atob(mainScriptUrlOrBlob.slice(mainScriptUrlOrBlob.lastIndexOf("#") + 1))
    );
    if (path.endsWith(".wasm")) return wasmURL;
  }
  return prefix + path;
}

Module["stringToPtr"] = stringToPtr;
Module["stringsToPtr"] = stringsToPtr;
Module["print"] = print;
Module["printErr"] = printErr;
Module["locateFile"] = _locateFile;

Module["exec"] = exec;
Module["ffprobe"] = ffprobe;
Module["setLogger"] = setLogger;
Module["setTimeout"] = setTimeout;
Module["setProgress"] = setProgress;
Module["reset"] = reset;
Module["receiveProgress"] = receiveProgress;
