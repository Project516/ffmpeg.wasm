import js from "@eslint/js";
import globals from "globals";

// Lints tests/, run as `eslint tests`. Mirrors the old tests/.eslintrc.json.
export default [
  {
    files: ["tests/**/*.js"],
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
];
