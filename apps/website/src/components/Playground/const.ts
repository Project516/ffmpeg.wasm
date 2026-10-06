import coreSizes from "../../data/core-sizes.json";

export const CORE_VERSION = "0.16.0";

export const CORE_URL = `https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;
export const CORE_MT_URL = `https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;

const cdnURL = (pkg: string, file: string) =>
  `https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-${pkg}@${CORE_VERSION}/dist/umd/${file}`;

export const CORE_SIZE: Record<string, number> = {};
for (const pkg of ["core", "core-mt"]) {
  for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
    CORE_SIZE[cdnURL(pkg, file)] = coreSizes[pkg][file];
  }
}

export const SAMPLE_FILES = {
  "video.webm":
    "https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm",
};
