# syntax=docker/dockerfile:1.10@sha256:865e5dd094beca432e8c0a1d5e1c465db5f998dca4e439981029b3b81fb39ed5

# Base emsdk image with environment variables.
FROM emscripten/emsdk:6.0.11@sha256:cdefec943f04fd4b2b2fe23b0a1a346be9fc560ef5784a83faa27dd351381372 AS emsdk-base
ARG EXTRA_CFLAGS
ARG EXTRA_LDFLAGS
ARG FFMPEG_ST
ARG FFMPEG_MT
ENV INSTALL_DIR=/opt
# Both cores build the same FFmpeg release now: n9.0.2's fftools has needed
# real threads (the fftools scheduler) since n6.0, and the st core gets them
# via src/pthread-fiber, a cooperative pthread shim on Emscripten fibers,
# since it has no SharedArrayBuffer for real ones. See "FFmpeg upgrade plan"
# in AGENTS.md. Kept as two variables, both n9.0.2, only so a future version
# bump can stage st and mt separately again if needed.
ENV FFMPEG_VERSION_ST=n9.0.2
ENV FFMPEG_VERSION_MT=n9.0.2
ENV FFMPEG_COMMIT_ST=946fcce07b6dcd0331c8cc609192aeff5e1924f8
ENV FFMPEG_COMMIT_MT=946fcce07b6dcd0331c8cc609192aeff5e1924f8
# Clang shipped with emsdk 6.0.11 defaults several legacy-C88/C89 patterns
# (implicit function declarations, mismatched function pointer types, and
# int/pointer conversions) to hard errors. Some of the bundled third-party
# libraries still rely on that older, looser C dialect in a few places, so
# demote those checks back to warnings rather than patching every call site.
ENV CFLAGS="-I$INSTALL_DIR/include -Wno-error=implicit-function-declaration -Wno-error=incompatible-function-pointer-types -Wno-error=int-conversion $CFLAGS $EXTRA_CFLAGS"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib $LDFLAGS $CFLAGS $EXTRA_LDFLAGS"
ENV EM_PKG_CONFIG_PATH=$EM_PKG_CONFIG_PATH:$INSTALL_DIR/lib/pkgconfig:/emsdk/upstream/emscripten/system/lib/pkgconfig
ENV EM_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
ENV PKG_CONFIG_PATH=$PKG_CONFIG_PATH:$EM_PKG_CONFIG_PATH
ENV FFMPEG_ST=$FFMPEG_ST
ENV FFMPEG_MT=$FFMPEG_MT
RUN apt-get update && \
      apt-get install -y pkg-config autoconf automake libtool ragel meson ninja-build git

# Build x264
# No stable release tags exist upstream; the ffmpegwasm mirror's `4-cores`
# branch has diverged far enough from current VideoLAN x264 (verified by
# diffing a shallow clone of each) that porting its emscripten/parallel-build
# patch onto current upstream is out of scope here. Kept pinned as-is.
FROM emsdk-base AS x264-builder
ENV X264_BRANCH=4-cores
ENV X264_COMMIT=33cac6b77d5b9259c552156013a817ab23119612
ADD https://github.com/ffmpegwasm/x264.git#$X264_COMMIT /src
COPY build/x264.sh /src/build.sh
RUN bash -x /src/build.sh

# Build x265
# The ffmpegwasm mirror's 3.4 tag is byte-identical to upstream's 3.4 tag
# (only difference is a stray .hgtags file from the old Mercurial mirror), so
# there is no emscripten patch to preserve. Build straight from canonical
# upstream.
FROM emsdk-base AS x265-builder
ENV X265_BRANCH=4.2
ENV X265_COMMIT=e444744c03978c1fb4e037168967020cf2648427
ADD https://bitbucket.org/multicoreware/x265_git.git#$X265_COMMIT /src
COPY build/x265.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libvpx
# ffmpegwasm mirror tag matches upstream webmproject/libvpx byte-for-byte;
# build from canonical upstream.
FROM emsdk-base AS libvpx-builder
ENV LIBVPX_BRANCH=v1.17.0
ENV LIBVPX_COMMIT=6df3ec34557879fff673706f4a1d9fbd0f3a6f0e
ADD https://github.com/webmproject/libvpx.git#$LIBVPX_COMMIT /src
COPY build/libvpx.sh /src/build.sh
RUN bash -x /src/build.sh

# Build lame
# Upstream lame (SourceForge CVS mirror) has not tagged a release since
# 3.100 (2017) and carries no usable git tags; the ffmpegwasm mirror is the
# only maintained git source, so it stays pinned to its master branch.
FROM emsdk-base AS lame-builder
ENV LAME_BRANCH=master
ENV LAME_COMMIT=2badea1974ae36cb8312afe99cff1e6b3b5decee
ADD https://github.com/ffmpegwasm/lame.git#$LAME_COMMIT /src
COPY build/lame.sh /src/build.sh
RUN bash -x /src/build.sh

# Build ogg
# ffmpegwasm mirror tag matches upstream xiph/ogg byte-for-byte; build from
# canonical upstream.
FROM emsdk-base AS ogg-builder
ENV OGG_BRANCH=v1.3.6
ENV OGG_COMMIT=be05b13e98b048f0b5a0f5fa8ce514d56db5f822
ADD https://github.com/xiph/ogg.git#$OGG_COMMIT /src
COPY build/ogg.sh /src/build.sh
RUN bash -x /src/build.sh

# Build theora
# ffmpegwasm mirror tag matches upstream xiph/theora byte-for-byte; build
# from canonical upstream. No release since v1.1.1 (2010).
FROM emsdk-base AS theora-builder
COPY --from=ogg-builder $INSTALL_DIR $INSTALL_DIR
ENV THEORA_BRANCH=v1.1.1
ENV THEORA_COMMIT=7ffd8b2ecfc2d93ae5e16028e7528e609266bfbf
ADD https://github.com/xiph/theora.git#$THEORA_COMMIT /src
COPY build/theora.sh /src/build.sh
RUN bash -x /src/build.sh

# Build opus
# ffmpegwasm mirror tag matches upstream xiph/opus byte-for-byte; build from
# canonical upstream.
FROM emsdk-base AS opus-builder
ENV OPUS_BRANCH=v1.6.1
ENV OPUS_COMMIT=22244de5a79bd1d6d623c32e72bf1954b56235be
ADD https://github.com/xiph/opus.git#$OPUS_COMMIT /src
COPY build/opus.sh /src/build.sh
RUN bash -x /src/build.sh

# Build vorbis
# ffmpegwasm mirror tag matches upstream xiph/vorbis byte-for-byte; build
# from canonical upstream.
FROM emsdk-base AS vorbis-builder
COPY --from=ogg-builder $INSTALL_DIR $INSTALL_DIR
ENV VORBIS_BRANCH=v1.3.7
ENV VORBIS_COMMIT=0657aee69dec8508a0011f47f3b69d7538e9d262
ADD https://github.com/xiph/vorbis.git#$VORBIS_COMMIT /src
COPY build/vorbis.sh /src/build.sh
RUN bash -x /src/build.sh

# Build zlib
# ffmpegwasm mirror tag matches upstream madler/zlib byte-for-byte; build
# from canonical upstream.
FROM emsdk-base AS zlib-builder
ENV ZLIB_BRANCH=v1.3.2
ENV ZLIB_COMMIT=da607da739fa6047df13e66a2af6b8bec7c2a498
ADD https://github.com/madler/zlib.git#$ZLIB_COMMIT /src
COPY build/zlib.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libwebp
# ffmpegwasm mirror tag matches upstream webmproject/libwebp byte-for-byte;
# build from canonical upstream.
FROM emsdk-base AS libwebp-builder
COPY --from=zlib-builder $INSTALL_DIR $INSTALL_DIR
ENV LIBWEBP_BRANCH=v1.6.0
ENV LIBWEBP_COMMIT=4fa21912338357f89e4fd51cf2368325b59e9bd9
ADD https://github.com/webmproject/libwebp.git#$LIBWEBP_COMMIT /src
COPY build/libwebp.sh /src/build.sh
RUN bash -x /src/build.sh

# Build freetype2
# ffmpegwasm mirror tag matches upstream freetype byte-for-byte; build from
# canonical upstream (freetype moved its primary repo to gitlab.freedesktop.org).
FROM emsdk-base AS freetype2-builder
ENV FREETYPE2_BRANCH=VER-2-14-3
ENV FREETYPE2_COMMIT=0a0221a1347e2f1e07c395263540026e9a0aa7c7
ADD https://gitlab.freedesktop.org/freetype/freetype.git#$FREETYPE2_COMMIT /src
COPY build/freetype2.sh /src/build.sh
RUN bash -x /src/build.sh

# Build fribidi
FROM emsdk-base AS fribidi-builder
ENV FRIBIDI_BRANCH=v1.0.17
ENV FRIBIDI_COMMIT=b93119f5fdc7ea47672cc304c1455ffa6dfe7536
ADD https://github.com/fribidi/fribidi.git#$FRIBIDI_COMMIT /src
COPY build/fribidi.sh /src/build.sh
RUN bash -x /src/build.sh

# Build harfbuzz
# Pinned to 8.5.0, the last release before harfbuzz dropped its autotools
# build (9.0.0 is meson-only). Jumping further needs build/harfbuzz.sh
# rewritten around meson + an emscripten cross file; left for a follow-up
# so this PR stays focused on the toolchain/library version bump.
FROM emsdk-base AS harfbuzz-builder
ENV HARFBUZZ_BRANCH=8.5.0
ENV HARFBUZZ_COMMIT=30485ee8c3d43c553afb9d78b9924cb71c8d2f19
ADD https://github.com/harfbuzz/harfbuzz.git#$HARFBUZZ_COMMIT /src
COPY build/harfbuzz.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libass
FROM emsdk-base AS libass-builder
COPY --from=freetype2-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=fribidi-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=harfbuzz-builder $INSTALL_DIR $INSTALL_DIR
ENV LIBASS_BRANCH=0.17.5
ENV LIBASS_COMMIT=4a05d8127f525943ebf45fdc6497c9e665947f0d
ADD https://github.com/libass/libass.git#$LIBASS_COMMIT /src
COPY build/libass.sh /src/build.sh
RUN bash -x /src/build.sh

# Build zimg
FROM emsdk-base AS zimg-builder
ENV ZIMG_BRANCH=release-3.0.6
ENV ZIMG_COMMIT=f819b14e8f39d1282400b0d9543e8ef73c1b2bbd
RUN apt-get update && apt-get install -y git
RUN git clone --recursive -b $ZIMG_BRANCH https://github.com/sekrit-twc/zimg.git /src && \
    test "$(git -C /src rev-parse HEAD)" = "$ZIMG_COMMIT"
COPY build/zimg.sh /src/build.sh
RUN bash -x /src/build.sh

# Build dav1d
FROM emsdk-base AS dav1d-builder
ENV DAV1D_BRANCH=1.5.4
ENV DAV1D_COMMIT=54706fc6bc0cdecab7e9593974a4039cc038fca7
ADD https://code.videolan.org/videolan/dav1d.git#$DAV1D_COMMIT /src
COPY build/meson-cross.ini /meson-cross.ini
COPY build/dav1d.sh /src/build.sh
RUN bash -x /src/build.sh

# Base ffmpeg image with dependencies and source code populated.
FROM emsdk-base AS ffmpeg-base
# Pick the FFmpeg release per FFMPEG_MT (see the FFMPEG_VERSION_ST/MT comment
# above), then apply the fftools patches, now needed by both cores.
# build/patches/n9 makes fftools work as a wasm runtime instead of a process:
# renaming main()/duplicate ffprobe symbols, routing exit()/exit codes
# through Module.ret instead of tearing down the runtime, progress and
# timeout reporting, resetting globals that fftools's upstream assumes are
# only ever initialized once per process, and (st only, guarded by
# FFMPEG_WASM_ST) forcing av_cpu_count() to 1 so FFmpeg's own codec-level
# threading stays off.
COPY build/patches /src-patches
RUN if [ -n "$FFMPEG_MT" ]; then FFMPEG_VERSION="$FFMPEG_VERSION_MT"; FFMPEG_COMMIT="$FFMPEG_COMMIT_MT"; else FFMPEG_VERSION="$FFMPEG_VERSION_ST"; FFMPEG_COMMIT="$FFMPEG_COMMIT_ST"; fi && \
    git clone --depth 1 --branch "$FFMPEG_VERSION" https://github.com/FFmpeg/FFmpeg.git /src && \
    cd /src && test "$(git rev-parse HEAD)" = "$FFMPEG_COMMIT" && patch -p1 < /src-patches/n9/fftools-wasm.patch
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
COPY --from=dav1d-builder $INSTALL_DIR $INSTALL_DIR

# Build ffmpeg
# PRESET picks build/presets/<PRESET>.env, which sets the FFmpeg configure
# flags (FFMPEG_FLAGS), the libraries to link (FFMPEG_LIBS) and, optionally,
# extra emcc link flags (FFMPEG_LINK_FLAGS). The ARG is declared in this stage
# so changing it only invalidates the layers from here on. The library stages
# above build for every preset; a preset only changes what FFmpeg enables and
# what the core links.
FROM ffmpeg-base AS ffmpeg-builder
ARG PRESET=full
COPY build/presets/${PRESET}.env /src/preset.env
COPY build/ffmpeg.sh /src/build.sh
RUN . /src/preset.env && bash -x /src/build.sh $FFMPEG_FLAGS

# Build ffmpeg.wasm
FROM ffmpeg-builder AS ffmpeg-wasm-builder
COPY src/bind /src/src/bind
COPY src/pthread-fiber /src/src/pthread-fiber
COPY build/ffmpeg-wasm.sh build.sh
# A classic worker that loads the UMD core with importScripts() has the
# wrapper worker as self.location, and pthreads would spawn that script. Point
# them at the core instead, via the mainScriptUrlOrBlob that
# @project516/ffmpeg-wasm passes. The grep fails the build if emsdk changes the
# line this relies on.
RUN . /src/preset.env && mkdir -p /src/dist/umd && bash -x /src/build.sh \
      ${FFMPEG_LIBS} ${FFMPEG_LINK_FLAGS:-} \
      -o dist/umd/ffmpeg-core.js && \
    sed -i 's/_scriptName=self.location.href/_scriptName=Module["mainScriptUrlOrBlob"]||self.location.href/' dist/umd/ffmpeg-core.js && \
    grep -q 'mainScriptUrlOrBlob"\]||self.location.href' dist/umd/ffmpeg-core.js
RUN . /src/preset.env && mkdir -p /src/dist/esm && bash -x /src/build.sh \
      ${FFMPEG_LIBS} ${FFMPEG_LINK_FLAGS:-} \
      -sEXPORT_ES6 \
      -o dist/esm/ffmpeg-core.js

# Export ffmpeg-core.wasm to dist/, use `docker buildx build -o . .` to get assets
FROM scratch AS exportor
COPY --from=ffmpeg-wasm-builder /src/dist /dist
