import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
    ssr: false,
    server: {
        static: true,
    },
    vite: {
        optimizeDeps: {
            exclude: ['@project516/ffmpeg-wasm', '@project516/ffmpeg-wasm-util']
        },
    }
});
