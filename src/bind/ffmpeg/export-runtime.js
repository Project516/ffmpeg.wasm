const EXPORTED_RUNTIME_METHODS = [
  "FS",
  "setValue",
  "getValue",
  "UTF8ToString",
  "lengthBytesUTF8",
  "stringToUTF8",
  // Not used by bind.js itself (stackSave/stackRestore are already in scope
  // as plain runtime functions there); exported so tests can assert exec()/
  // ffprobe() leave the wasm stack where they found it.
  "stackSave",
  "stackRestore",
];

console.log(EXPORTED_RUNTIME_METHODS.join(","));
