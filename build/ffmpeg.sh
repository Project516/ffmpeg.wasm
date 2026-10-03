#!/bin/bash

set -euo pipefail

# libavutil/cpu.c's av_cpu_count() (patched by build/patches/n9) checks this
# macro to force single-core behavior on the st core, since it has no
# SharedArrayBuffer to back real codec-level threading. Set it here, not just
# for fftools, since it needs to reach every FFmpeg C file the st build
# compiles.
CFLAGS="${FFMPEG_ST:+-DFFMPEG_WASM_ST=1 }$CFLAGS"
CXXFLAGS="${FFMPEG_ST:+-DFFMPEG_WASM_ST=1 }$CXXFLAGS"

CONF_FLAGS=(
  --target-os=none              # disable target specific configs
  --arch=x86_32                 # use x86_32 arch
  --enable-cross-compile        # use cross compile configs
  --disable-asm                 # disable asm
  --disable-stripping           # disable stripping as it won't work
  --disable-programs            # disable ffmpeg, ffprobe and ffplay build
  --disable-doc                 # disable doc build
  --disable-debug               # disable debug mode
  --disable-runtime-cpudetect   # disable cpu detection
  --disable-autodetect          # disable env auto detect

  # assign toolchains and extra flags
  --nm=emnm
  --ar=emar
  --ranlib=emranlib
  --cc=emcc
  --cxx=em++
  --objcc=emcc
  --dep-cc=emcc
  --extra-cflags="$CFLAGS"
  --extra-cxxflags="$CXXFLAGS"
  # Every dependency here is a static-only build. Current upstream .pc files
  # (vorbisenc, etc.) list their transitive deps under Requires.private,
  # which plain `pkg-config --libs` ignores; --static tells pkg-config to
  # include those too, or linking fails with undefined symbols/"not found".
  --pkg-config-flags="--static"
  # x265 is C++, and emcc only links libc++ when told to.
  --extra-ldflags="-sDEFAULT_TO_CXX"

  # FFmpeg n9's default (--stdc=c17) is strict ISO C, which rejects the GNU
  # statement-expression extension emscripten's EM_ASM/EM_JS macros need
  # (see build/patches/n9). Both cores build n9 now, so this applies to both.
  --stdc=gnu17
)

emconfigure ./configure "${CONF_FLAGS[@]}" $@ || { cat ffbuild/config.log; exit 1; }
emmake make -j

# Both cores now link FFmpeg n9's own fftools sources (patched, see
# build/patches/n9) instead of the vendored copies under src/fftools.
# --disable-programs above skips linking the ffmpeg/ffprobe binaries (we
# don't want or need them), but fftools/Makefile's object rules are
# unconditional, so the objects can be built directly and linked by
# build/ffmpeg-wasm.sh.
emmake make -j \
  fftools/cmdutils.o \
  fftools/opt_common.o \
  fftools/ffmpeg.o \
  fftools/ffmpeg_dec.o \
  fftools/ffmpeg_demux.o \
  fftools/ffmpeg_enc.o \
  fftools/ffmpeg_filter.o \
  fftools/ffmpeg_hw.o \
  fftools/ffmpeg_mux.o \
  fftools/ffmpeg_mux_init.o \
  fftools/ffmpeg_opt.o \
  fftools/ffmpeg_sched.o \
  fftools/graph/graphprint.o \
  fftools/sync_queue.o \
  fftools/thread_queue.o \
  fftools/textformat/avtextformat.o \
  fftools/textformat/tf_compact.o \
  fftools/textformat/tf_default.o \
  fftools/textformat/tf_flat.o \
  fftools/textformat/tf_ini.o \
  fftools/textformat/tf_json.o \
  fftools/textformat/tf_mermaid.o \
  fftools/textformat/tf_xml.o \
  fftools/textformat/tw_avio.o \
  fftools/textformat/tw_buffer.o \
  fftools/textformat/tw_stdout.o \
  fftools/resources/resman.o \
  fftools/resources/graph.html.o \
  fftools/resources/graph.css.o \
  fftools/ffprobe.o
