#!/bin/bash
# `-o <OUTPUT_FILE_NAME>` must be provided when using this build script.
# ex:
#     bash ffmpeg-wasm.sh -o ffmpeg.js

set -euo pipefail

EXPORT_NAME="createFFmpegCore"

# Both cores now build FFmpeg n9.0.2 (which dropped libpostproc) and link the
# fftools objects that build/ffmpeg.sh already compiled from FFmpeg's own
# patched source tree (see build/patches/n9). The st core additionally links
# a small cooperative pthread shim (src/pthread-fiber) so fftools' scheduler
# (fftools/ffmpeg_sched.c), which pthread_creates a real thread per demuxer/
# decoder/filtergraph/encoder/muxer, runs without SharedArrayBuffer; see
# "FFmpeg upgrade plan" in AGENTS.md.
AVLIBS=(
  -Llibavcodec -Llibavdevice -Llibavfilter -Llibavformat -Llibavutil
  -Llibswresample -Llibswscale
  -lavcodec -lavdevice -lavfilter -lavformat -lavutil -lswresample -lswscale
)
FFTOOLS=(
  fftools/cmdutils.o
  fftools/opt_common.o
  fftools/ffmpeg.o
  fftools/ffmpeg_dec.o
  fftools/ffmpeg_demux.o
  fftools/ffmpeg_enc.o
  fftools/ffmpeg_filter.o
  fftools/ffmpeg_hw.o
  fftools/ffmpeg_mux.o
  fftools/ffmpeg_mux_init.o
  fftools/ffmpeg_opt.o
  fftools/ffmpeg_sched.o
  fftools/graph/graphprint.o
  fftools/sync_queue.o
  fftools/thread_queue.o
  fftools/textformat/avtextformat.o
  fftools/textformat/tf_compact.o
  fftools/textformat/tf_default.o
  fftools/textformat/tf_flat.o
  fftools/textformat/tf_ini.o
  fftools/textformat/tf_json.o
  fftools/textformat/tf_mermaid.o
  fftools/textformat/tf_xml.o
  fftools/textformat/tw_avio.o
  fftools/textformat/tw_buffer.o
  fftools/textformat/tw_stdout.o
  fftools/resources/resman.o
  fftools/resources/graph.html.o
  fftools/resources/graph.css.o
  fftools/ffprobe.o
)
FFTOOLS_INC=()
if [ -n "${FFMPEG_MT:-}" ]; then
  FFTOOLS+=(src/bind/ffmpeg/threads.c)
fi
PTHREAD_FIBER_FLAGS=()
# How a thread switch is done. FFMPEG_JSPI is the opt-in core-jspi build: the
# same shim, but a switch suspends the wasm stack with JSPI. exec() and
# ffprobe() then return Promises; see runCommand in src/bind/ffmpeg/bind.js.
if [ -n "${FFMPEG_JSPI:-}" ]; then
  PTHREAD_FIBER_SWITCH_FLAGS=(
    -sJSPI
    -sJSPI_EXPORTS=ffmpeg,ffprobe,pfiber_enter
    -DPFIBER_JSPI
  )
else
  PTHREAD_FIBER_SWITCH_FLAGS=(
    -sASYNCIFY
    # Sizes the single module-wide asyncify stack, which only emscripten_sleep()
    # uses and nothing here calls. Each fiber carries its own asyncify stack
    # for fiber swaps; see PFIBER_ASYNCIFY_STACK_SIZE in pthread_fiber.c.
    -sASYNCIFY_STACK_SIZE=65536
  )
fi

if [ -n "${FFMPEG_ST:-}" ]; then
  FFTOOLS+=(src/pthread-fiber/pthread_fiber.c)
  FFTOOLS_INC+=(-Isrc/pthread-fiber)
  # No SharedArrayBuffer on the st core, so fftools' real pthread_create/
  # mutex/cond calls are redirected to src/pthread-fiber's cooperative
  # scheduler built on Emscripten fibers.
  #
  # ASYNCIFY is required, not optional (core-jspi uses JSPI instead): emscripten implements
  # emscripten_fiber_swap itself in src/lib/libasync.js and a build without
  # ASYNCIFY only gets a stub that aborts. What the scheduler must not do is
  # call emscripten_sleep(), which would start a second asyncify operation
  # while a fiber swap is still rewinding; see pf_idle_wait in
  # src/pthread-fiber/pthread_fiber.c.
  PTHREAD_FIBER_FLAGS+=(
    "${PTHREAD_FIBER_SWITCH_FLAGS[@]}"
    # ASSERTIONS also turns on emscripten's checkIncomingModuleAPI(), which
    # aborts at load when the caller supplies a Module property that is not in
    # INCOMING_MODULE_JS_API. @project516/ffmpeg-wasm always supplies
    # mainScriptUrlOrBlob (see packages/ffmpeg/src/worker.ts) and bind.js reads
    # it in _locateFile, but emscripten only adds that property to the incoming
    # list for a PTHREADS build, and the st core has none: without pthreads
    # libpthread.js, which is what pulls it in, is not linked. So ASSERTIONS
    # makes the st core fail to load while the mt core is fine. It costs speed
    # too, so it comes out.
    -sASSERTIONS=0
    -Wl,--wrap=pthread_create
    -Wl,--wrap=pthread_join
    -Wl,--wrap=pthread_detach
    -Wl,--wrap=pthread_self
    -Wl,--wrap=pthread_equal
    -Wl,--wrap=pthread_once
    -Wl,--wrap=pthread_mutex_init
    -Wl,--wrap=pthread_mutex_destroy
    -Wl,--wrap=pthread_mutex_lock
    -Wl,--wrap=pthread_mutex_trylock
    -Wl,--wrap=pthread_mutex_unlock
    -Wl,--wrap=pthread_cond_init
    -Wl,--wrap=pthread_cond_destroy
    -Wl,--wrap=pthread_cond_wait
    -Wl,--wrap=pthread_cond_timedwait
    -Wl,--wrap=pthread_cond_signal
    -Wl,--wrap=pthread_cond_broadcast
    -Wl,--wrap=usleep
    -Wl,--wrap=nanosleep
  )
fi

CONF_FLAGS=(
  -I.
  "${FFTOOLS_INC[@]}"
  -I$INSTALL_DIR/include
  -L$INSTALL_DIR/lib
  "${AVLIBS[@]}"
  -Wno-deprecated-declarations
  $LDFLAGS
  -sENVIRONMENT=web,worker,node             # web for loading the core directly on a page, worker for @project516/ffmpeg-wasm, node for running the worker under Node.js
  -sWASM_BIGINT                            # enable big int support
  -fexceptions                             # catch zimg's exceptions; JS-based, so it works with Asyncify
  -sDEFAULT_TO_CXX                         # link libc++, which x265 needs
  -sSTACK_SIZE=5MB                         # increase stack size to support libopus
  -sMODULARIZE                             # modularized to use as a library
  ${FFMPEG_MT:+ -sINITIAL_MEMORY=1024MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB} # start with a large initial memory, but still allow growth (capped at 4GB) so a single high-res frame (e.g. 4K) does not abort with OOM
  ${FFMPEG_MT:+ -sPTHREAD_POOL_SIZE=32}    # use 32 threads
  ${FFMPEG_MT:+ -sPTHREAD_POOL_SIZE_STRICT=2} # fail instead of hanging when a command needs more threads than the pool has
  ${FFMPEG_MT:+ -sDEFAULT_PTHREAD_STACK_SIZE=2MB} # the 64KB default overflows in x264 and decoder threads
  ${FFMPEG_ST:+ -sINITIAL_MEMORY=48MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB} # Use just enough memory as memory usage can grow, plus headroom for pthread-fiber's per-thread stacks and Asyncify's own overhead
  "${PTHREAD_FIBER_FLAGS[@]}"
  -sEXPORT_NAME="$EXPORT_NAME"             # required in browser env, so that user can access this module from window object
  -sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js) # exported functions
  -sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js) # exported built-in functions
  -lworkerfs.js
  --pre-js src/bind/ffmpeg/bind.js        # extra bindings, contains most of the ffmpeg.wasm javascript code
  # ffmpeg source code (or precompiled objects for the mt/n9 build; see above)
  "${FFTOOLS[@]}"
)

emcc "${CONF_FLAGS[@]}" $@
