const TIMEOUT = 60000;
const IS_BROWSER = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const OPTIONS = {
  corePath: IS_BROWSER ? 'http://localhost:3000/node_modules/@project516/ffmpeg-wasm-core/dist/ffmpeg-core.js' : '@project516/ffmpeg-wasm-core',
};
const FLAME_MP4_LENGTH = 100374;
const META_FLAME_MP4_LENGTH = 100408;
const META_FLAME_MP4_LENGTH_NO_SPACE = 100404;

if (typeof module !== 'undefined') {
  module.exports = {
    TIMEOUT,
    IS_BROWSER,
    OPTIONS,
    FLAME_MP4_LENGTH,
    META_FLAME_MP4_LENGTH,
    META_FLAME_MP4_LENGTH_NO_SPACE,
  };
}
