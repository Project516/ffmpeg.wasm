#!/bin/bash

set -euo pipefail

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

  # disable thread when FFMPEG_ST is NOT defined
  ${FFMPEG_ST:+ --disable-pthreads --disable-w32threads --disable-os2threads}
)

emconfigure ./configure "${CONF_FLAGS[@]}" $@ || { tail -n 80 ffbuild/config.log; exit 1; }
emmake make -j
