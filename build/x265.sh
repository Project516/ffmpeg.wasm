#!/bin/bash

set -euo pipefail

BASE_FLAGS=(
  -DCMAKE_TOOLCHAIN_FILE=$EM_TOOLCHAIN_FILE
  # Emscripten's toolchain file reports CMAKE_SYSTEM_PROCESSOR=x86 by default
  # (for OpenCV-style bitness checks). x265's CMakeLists.txt treats any
  # 32-bit x86 target as real ia32 and force-adds `-march=i686`, which emcc's
  # clang rejects outright for wasm32. Report a processor name x265 has no
  # special case for so it skips that codepath instead.
  -DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm32
  -DENABLE_LIBNUMA=OFF
  -DENABLE_SHARED=OFF
  -DENABLE_CLI=OFF
)

FLAGS_12BIT=(
  ${BASE_FLAGS[@]}
  -DHIGH_BIT_DEPTH=ON
  -DEXPORT_C_API=OFF
  -DMAIN12=ON
)

FLAGS_10BIT=(
  ${BASE_FLAGS[@]}
  -DHIGH_BIT_DEPTH=ON
  -DEXPORT_C_API=OFF
)

FLAGS_MAIN=(
  ${BASE_FLAGS[@]}
  -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR
  -DEXTRA_LIB="x265_main10.a;x265_main12.a"
  -DEXTRA_LINK_FLAGS=-L.
  -DLINKED_10BIT=ON
  -DLINKED_12BIT=ON
)

cd source
rm -rf build
mkdir -p build
cd build
mkdir -p main 10bit 12bit

cd 12bit
emmake cmake ../.. -DCMAKE_CXX_FLAGS="$CXXFLAGS" ${FLAGS_12BIT[@]}
emmake make -j

cd ../10bit 
emmake cmake ../.. -DCMAKE_CXX_FLAGS="$CXXFLAGS" ${FLAGS_10BIT[@]}
emmake make -j

cd ../main
ln -sf ../10bit/libx265.a libx265_main10.a
ln -sf ../12bit/libx265.a libx265_main12.a
emmake cmake ../.. -DCMAKE_CXX_FLAGS="$CXXFLAGS" ${FLAGS_MAIN[@]}
emmake make -j
mv libx265.a libx265_main.a

# Merge static libraries
emar -M <<EOF
CREATE libx265.a
ADDLIB libx265_main.a
ADDLIB libx265_main10.a
ADDLIB libx265_main12.a
SAVE
END
EOF
emmake make install -j
