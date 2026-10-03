#ifndef PTHREAD_FIBER_H
#define PTHREAD_FIBER_H

/*
 * Cooperative pthread_* shim for the st (single-thread, no SharedArrayBuffer)
 * ffmpeg.wasm core. FFmpeg n9's fftools scheduler (fftools/ffmpeg_sched.c)
 * pthread_creates a real OS thread per demuxer/decoder/filtergraph/encoder/
 * muxer. Without SharedArrayBuffer there is no real concurrency available, so
 * this file implements the pthread_create/join/mutex/cond subset fftools and
 * libavutil/libavcodec/libavformat/libavfilter need on top of Emscripten
 * fibers (see pthread_fiber.c): every "thread" is a cooperatively scheduled
 * fiber, and only one of them ever runs C code at a time.
 *
 * FFmpeg source never needs to include this header directly: linking with
 * `-Wl,--wrap=pthread_create` (and one such flag per symbol below, see
 * build/ffmpeg-wasm.sh) redirects every reference to the real pthread_*
 * symbol name to the __wrap_* functions defined in pthread_fiber.c, so
 * FFmpeg keeps including the normal system <pthread.h>.
 */

#endif /* PTHREAD_FIBER_H */
