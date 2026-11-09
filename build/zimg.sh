#!/bin/bash

set -euo pipefail

CONF_FLAGS=(
  --prefix=$INSTALL_DIR            # lib installation directory
  --host=x86_64-linux-gnu          # use i686 linux host
  --disable-shared                 # build static library
  --enable-static                  # enable static library
  --disable-dependency-tracking    # speed up one-time build
  --disable-simd                   # disable simd optimization
)

# zimg reports errors by throwing. libc++ 23 no longer includes <exception>
# for zimg.cpp.
export CXXFLAGS="$CXXFLAGS -fexceptions -include exception"

emconfigure ./autogen.sh

emconfigure ./configure "${CONF_FLAGS[@]}"
emmake make install -j