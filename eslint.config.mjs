import js from "@eslint/js";
import globals from "globals";

// Lints tests/, run as `eslint tests`. Mirrors the old tests/.eslintrc.json.
export default [
  {
    files: ["tests/**/*.js", "tests/**/*.mjs"],
    ...js.configs.recommended,
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.mocha,
        CORE_URL: true,
        FFMPEG_TYPE: true,
        FFmpegWASM: true,
        VIDEO_1S_MP4: true,
        b64ToUint8Array: true,
        createFFmpegCore: true,
        expect: true,
      },
    },
  },
  {
    // The Node.js test suite (tests/ffmpeg-node.test.mjs): real ES modules,
    // run with `node`/mocha, not loaded on a test page like the .js files
    // above.
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
  },
];
