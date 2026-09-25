#!/bin/bash
# `-o <OUTPUT_FILE_NAME>` must be provided when using this build script.
# ex:
#     bash ffmpeg-wasm.sh -o ffmpeg.js

set -euo pipefail

EXPORT_NAME="createFFmpegCore"

# The st core (FFmpeg n5.1.10) still has libpostproc and links our vendored,
# patched fftools sources directly. The mt core (FFmpeg n9.0.2, which dropped
# libpostproc) instead links the fftools objects that build/ffmpeg.sh already
# compiled from FFmpeg's own patched source tree (see build/patches/n9); see
# "FFmpeg upgrade plan" in AGENTS.md for why the two cores are on different
# FFmpeg releases.
if [ -n "${FFMPEG_MT:-}" ]; then
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
else
  AVLIBS=(
    -Llibavcodec -Llibavdevice -Llibavfilter -Llibavformat -Llibavutil
    -Llibpostproc -Llibswresample -Llibswscale
    -lavcodec -lavdevice -lavfilter -lavformat -lavutil -lpostproc
    -lswresample -lswscale
  )
  FFTOOLS=(
    src/fftools/cmdutils.c
    src/fftools/ffmpeg.c
    src/fftools/ffmpeg_filter.c
    src/fftools/ffmpeg_hw.c
    src/fftools/ffmpeg_mux.c
    src/fftools/ffmpeg_opt.c
    src/fftools/opt_common.c
    src/fftools/ffprobe.c
  )
  FFTOOLS_INC=(-I./src/fftools)
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
  -sDEFAULT_TO_CXX                         # link libc++, which x265 needs
  -sUSE_SDL=2                              # use emscripten SDL2 lib port
  -sSTACK_SIZE=5MB                         # increase stack size to support libopus
  -sMODULARIZE                             # modularized to use as a library
  ${FFMPEG_MT:+ -sINITIAL_MEMORY=1024MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=2GB} # start with a large initial memory, but still allow growth (capped at 2GB) so a single high-res frame (e.g. 4K) does not abort with OOM
  ${FFMPEG_MT:+ -sPTHREAD_POOL_SIZE=32}    # use 32 threads
  ${FFMPEG_ST:+ -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH} # Use just enough memory as memory usage can grow
  -sEXPORT_NAME="$EXPORT_NAME"             # required in browser env, so that user can access this module from window object
  -sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js) # exported functions
  -sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js) # exported built-in functions
  -lworkerfs.js
  --pre-js src/bind/ffmpeg/bind.js        # extra bindings, contains most of the ffmpeg.wasm javascript code
  # ffmpeg source code (or precompiled objects for the mt/n9 build; see above)
  "${FFTOOLS[@]}"
)

emcc "${CONF_FLAGS[@]}" $@
