const EXPORTED_FUNCTIONS = ["_ffmpeg", "_abort", "_malloc", "_free", "_ffprobe"];

// The st core links the cooperative pthread shim in src/pthread-fiber and
// needs to tell it when a new top-level call starts; the mt core has real
// pthreads, no shim, and no such symbol to export. FFMPEG_ST is set for the
// st build only (see the ARG in the Dockerfile and build/ffmpeg-wasm.sh).
if (process.env.FFMPEG_ST) EXPORTED_FUNCTIONS.push("_pfiber_begin_call");

// Called from bind.js to start a thread of the JSPI build on its own stack.
if (process.env.FFMPEG_JSPI) EXPORTED_FUNCTIONS.push("_pfiber_enter");

console.log(EXPORTED_FUNCTIONS.join(","));
