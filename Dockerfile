# syntax=docker/dockerfile-upstream:master-labs

# Base emsdk image with environment variables.
FROM emscripten/emsdk:6.0.10 AS emsdk-base
ARG EXTRA_CFLAGS
ARG EXTRA_LDFLAGS
ARG FFMPEG_ST
ARG FFMPEG_MT
ENV INSTALL_DIR=/opt
# We cannot upgrade past n5.x as ffmpeg's CLI has required real threads
# (the fftools scheduler) since n6.0; see AGENTS.md for the staged plan.
ENV FFMPEG_VERSION=n5.1.10
# Clang shipped with emsdk 6.0.10 defaults several legacy-C88/C89 patterns
# (implicit function declarations, mismatched function pointer types, and
# int/pointer conversions) to hard errors. n5.1.10 and its bundled libraries
# still rely on that older, looser C dialect in a few places, so demote those
# checks back to warnings rather than patching every call site.
ENV CFLAGS="-I$INSTALL_DIR/include -Wno-error=implicit-function-declaration -Wno-error=incompatible-function-pointer-types -Wno-error=int-conversion $CFLAGS $EXTRA_CFLAGS"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib $LDFLAGS $CFLAGS $EXTRA_LDFLAGS"
ENV EM_PKG_CONFIG_PATH=$EM_PKG_CONFIG_PATH:$INSTALL_DIR/lib/pkgconfig:/emsdk/upstream/emscripten/system/lib/pkgconfig
ENV EM_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
ENV PKG_CONFIG_PATH=$PKG_CONFIG_PATH:$EM_PKG_CONFIG_PATH
ENV FFMPEG_ST=$FFMPEG_ST
ENV FFMPEG_MT=$FFMPEG_MT
RUN apt-get update && \
      apt-get install -y pkg-config autoconf automake libtool ragel meson ninja-build

# Build x264
# No stable release tags exist upstream; the ffmpegwasm mirror's `4-cores`
# branch has diverged far enough from current VideoLAN x264 (verified by
# diffing a shallow clone of each) that porting its emscripten/parallel-build
# patch onto current upstream is out of scope here. Kept pinned as-is.
FROM emsdk-base AS x264-builder
ENV X264_BRANCH=4-cores
ADD https://github.com/ffmpegwasm/x264.git#$X264_BRANCH /src
COPY build/x264.sh /src/build.sh
RUN bash -x /src/build.sh

# Build x265
# The ffmpegwasm mirror's 3.4 tag is byte-identical to upstream's 3.4 tag
# (only difference is a stray .hgtags file from the old Mercurial mirror), so
# there is no emscripten patch to preserve. Build straight from canonical
# upstream.
FROM emsdk-base AS x265-builder
ENV X265_BRANCH=4.2
ADD https://bitbucket.org/multicoreware/x265_git.git#$X265_BRANCH /src
COPY build/x265.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libvpx
# ffmpegwasm mirror tag matches upstream webmproject/libvpx byte-for-byte;
# build from canonical upstream.
FROM emsdk-base AS libvpx-builder
ENV LIBVPX_BRANCH=v1.17.0
ADD https://github.com/webmproject/libvpx.git#$LIBVPX_BRANCH /src
COPY build/libvpx.sh /src/build.sh
RUN bash -x /src/build.sh

# Build lame
# Upstream lame (SourceForge CVS mirror) has not tagged a release since
# 3.100 (2017) and carries no usable git tags; the ffmpegwasm mirror is the
# only maintained git source, so it stays pinned to its master branch.
FROM emsdk-base AS lame-builder
ENV LAME_BRANCH=master
ADD https://github.com/ffmpegwasm/lame.git#$LAME_BRANCH /src
COPY build/lame.sh /src/build.sh
RUN bash -x /src/build.sh

# Build ogg
# ffmpegwasm mirror tag matches upstream xiph/ogg byte-for-byte; build from
# canonical upstream.
FROM emsdk-base AS ogg-builder
ENV OGG_BRANCH=v1.3.6
ADD https://github.com/xiph/ogg.git#$OGG_BRANCH /src
COPY build/ogg.sh /src/build.sh
RUN bash -x /src/build.sh

# Build theora
# ffmpegwasm mirror tag matches upstream xiph/theora byte-for-byte; build
# from canonical upstream. No release since v1.1.1 (2010).
FROM emsdk-base AS theora-builder
COPY --from=ogg-builder $INSTALL_DIR $INSTALL_DIR
ENV THEORA_BRANCH=v1.1.1
ADD https://github.com/xiph/theora.git#$THEORA_BRANCH /src
COPY build/theora.sh /src/build.sh
RUN bash -x /src/build.sh

# Build opus
# ffmpegwasm mirror tag matches upstream xiph/opus byte-for-byte; build from
# canonical upstream.
FROM emsdk-base AS opus-builder
ENV OPUS_BRANCH=v1.6.1
ADD https://github.com/xiph/opus.git#$OPUS_BRANCH /src
COPY build/opus.sh /src/build.sh
RUN bash -x /src/build.sh

# Build vorbis
# ffmpegwasm mirror tag matches upstream xiph/vorbis byte-for-byte; build
# from canonical upstream.
FROM emsdk-base AS vorbis-builder
COPY --from=ogg-builder $INSTALL_DIR $INSTALL_DIR
ENV VORBIS_BRANCH=v1.3.7
ADD https://github.com/xiph/vorbis.git#$VORBIS_BRANCH /src
COPY build/vorbis.sh /src/build.sh
RUN bash -x /src/build.sh

# Build zlib
# ffmpegwasm mirror tag matches upstream madler/zlib byte-for-byte; build
# from canonical upstream.
FROM emsdk-base AS zlib-builder
ENV ZLIB_BRANCH=v1.3.2
ADD https://github.com/madler/zlib.git#$ZLIB_BRANCH /src
COPY build/zlib.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libwebp
# ffmpegwasm mirror tag matches upstream webmproject/libwebp byte-for-byte;
# build from canonical upstream.
FROM emsdk-base AS libwebp-builder
COPY --from=zlib-builder $INSTALL_DIR $INSTALL_DIR
ENV LIBWEBP_BRANCH=v1.6.0
ADD https://github.com/webmproject/libwebp.git#$LIBWEBP_BRANCH /src
COPY build/libwebp.sh /src/build.sh
RUN bash -x /src/build.sh

# Build freetype2
# ffmpegwasm mirror tag matches upstream freetype byte-for-byte; build from
# canonical upstream (freetype moved its primary repo to gitlab.freedesktop.org).
FROM emsdk-base AS freetype2-builder
ENV FREETYPE2_BRANCH=VER-2-14-3
ADD https://gitlab.freedesktop.org/freetype/freetype.git#$FREETYPE2_BRANCH /src
COPY build/freetype2.sh /src/build.sh
RUN bash -x /src/build.sh

# Build fribidi
FROM emsdk-base AS fribidi-builder
ENV FRIBIDI_BRANCH=v1.0.17
ADD https://github.com/fribidi/fribidi.git#$FRIBIDI_BRANCH /src
COPY build/fribidi.sh /src/build.sh
RUN bash -x /src/build.sh

# Build harfbuzz
# Pinned to 8.5.0, the last release before harfbuzz dropped its autotools
# build (9.0.0 is meson-only). Jumping further needs build/harfbuzz.sh
# rewritten around meson + an emscripten cross file; left for a follow-up
# so this PR stays focused on the toolchain/library version bump.
FROM emsdk-base AS harfbuzz-builder
ENV HARFBUZZ_BRANCH=8.5.0
ADD https://github.com/harfbuzz/harfbuzz.git#$HARFBUZZ_BRANCH /src
COPY build/harfbuzz.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libass
FROM emsdk-base AS libass-builder
COPY --from=freetype2-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=fribidi-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=harfbuzz-builder $INSTALL_DIR $INSTALL_DIR
ENV LIBASS_BRANCH=0.17.5
ADD https://github.com/libass/libass.git#$LIBASS_BRANCH /src
COPY build/libass.sh /src/build.sh
RUN bash -x /src/build.sh

# Build zimg
FROM emsdk-base AS zimg-builder
ENV ZIMG_BRANCH=release-3.0.6
RUN apt-get update && apt-get install -y git
RUN git clone --recursive -b $ZIMG_BRANCH https://github.com/sekrit-twc/zimg.git /src
COPY build/zimg.sh /src/build.sh
RUN bash -x /src/build.sh

# Base ffmpeg image with dependencies and source code populated.
FROM emsdk-base AS ffmpeg-base
RUN embuilder build sdl2 sdl2-mt
ADD https://github.com/FFmpeg/FFmpeg.git#$FFMPEG_VERSION /src
COPY --from=x264-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=x265-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=libvpx-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=lame-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=opus-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=theora-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=vorbis-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=libwebp-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=libass-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=zimg-builder $INSTALL_DIR $INSTALL_DIR

# Build ffmpeg
FROM ffmpeg-base AS ffmpeg-builder
COPY build/ffmpeg.sh /src/build.sh
RUN bash -x /src/build.sh \
      --enable-gpl \
      --enable-libx264 \
      --enable-libx265 \
      --enable-libvpx \
      --enable-libmp3lame \
      --enable-libtheora \
      --enable-libvorbis \
      --enable-libopus \
      --enable-zlib \
      --enable-libwebp \
      --enable-libfreetype \
      --enable-libfribidi \
      --enable-libass \
      --enable-libzimg 

# Build ffmpeg.wasm
FROM ffmpeg-builder AS ffmpeg-wasm-builder
COPY src/bind /src/src/bind
COPY src/fftools /src/src/fftools
COPY build/ffmpeg-wasm.sh build.sh
# libraries to link
ENV FFMPEG_LIBS \
      -lx264 \
      -lx265 \
      -lvpx \
      -lmp3lame \
      -logg \
      -ltheora \
      -lvorbis \
      -lvorbisenc \
      -lvorbisfile \
      -lopus \
      -lz \
      -lwebpmux \
      -lwebp \
      -lsharpyuv \
      -lfreetype \
      -lfribidi \
      -lharfbuzz \
      -lass \
      -lzimg
# A classic worker that loads the UMD core with importScripts() has the
# wrapper worker as self.location, and pthreads would spawn that script. Point
# them at the core instead, via the mainScriptUrlOrBlob that
# @project516/ffmpeg passes. The grep fails the build if emsdk changes the
# line this relies on.
RUN mkdir -p /src/dist/umd && bash -x /src/build.sh \
      ${FFMPEG_LIBS} \
      -o dist/umd/ffmpeg-core.js && \
    sed -i 's/_scriptName=self.location.href/_scriptName=Module["mainScriptUrlOrBlob"]||self.location.href/' dist/umd/ffmpeg-core.js && \
    grep -q 'mainScriptUrlOrBlob"\]||self.location.href' dist/umd/ffmpeg-core.js
RUN mkdir -p /src/dist/esm && bash -x /src/build.sh \
      ${FFMPEG_LIBS} \
      -sEXPORT_ES6 \
      -o dist/esm/ffmpeg-core.js

# Export ffmpeg-core.wasm to dist/, use `docker buildx build -o . .` to get assets
FROM scratch AS exportor
COPY --from=ffmpeg-wasm-builder /src/dist /dist
