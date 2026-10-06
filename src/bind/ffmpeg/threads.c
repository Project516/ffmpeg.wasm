#include <emscripten.h>

EM_JS(int, hardware_concurrency, (void), {
  return (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 1;
});

/* The core count FFmpeg, swscale and x264 size their thread pools for. Capped
 * so a many-core machine does not exhaust PTHREAD_POOL_SIZE. */
int emscripten_num_logical_cores(void)
{
    int n = hardware_concurrency();
    return n < 4 ? n : 4;
}
