#!/usr/bin/env bash
# Rebuild wllama's wasm (JSPI + Memory64 + WebGPU) from the exact commits of the vendored CI build,
# with tools/wllama-patches/*.patch applied, mirroring wllama's scripts/docker-compose.yml.
#
# usage: bash tools/build-wllama.sh            (sources/toolchain cached in $WORK, default <repo>/.work)
# output: $WORK/wsrc/build/wllama.{js,wasm}  -> consumed by tools/vendor-wllama.mjs --wasm-dir
# variants: BUILD_DIR=build-prof EXTRA_CMAKE_ARGS=-DGGML_WEBGPU_GPU_PROFILE=ON bash tools/build-wllama.sh
#           (per-shader GPU times via timestamp queries, printed when the model is unloaded; test only)
#
# Needs: git, curl, python. cmake+ninja come from PATH, else portable copies are fetched into $WORK/tools.
set -euo pipefail

WLLAMA_COMMIT=33b434625a722221754babf12baded33383d5d2e   # = https://github.ngxson.com/wllama build of 2026-11-05
LLAMA_COMMIT=5aeac37a35b44fde4bdffaec9159f2fcb253b622    # wllama's llama.cpp submodule at that commit
EMSDK_VERSION=4.0.20                                     # scripts/build_wasm.sh EMSDK_IMAGE_TAG
DAWN_TAG=v20260317.182325                                # scripts/docker-compose.yml DAWN_TAG
JOBS=${JOBS:-12}
BUILD_DIR=${BUILD_DIR:-build}
EXTRA_CMAKE_ARGS=${EXTRA_CMAKE_ARGS:-}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK=${WORK:-$ROOT/.work}
mkdir -p "$WORK"
cd "$WORK"
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

# --- sources -----------------------------------------------------------------
fetch() { # dir url commit
  if [ "$(git -C "$1" rev-parse HEAD 2>/dev/null)" != "$3" ]; then
    rm -rf "$1" && git init -q "$1" && git -C "$1" remote add origin "$2"
    git -C "$1" fetch -q --depth 1 origin "$3" && git -C "$1" checkout -q FETCH_HEAD
  fi
}
fetch wsrc https://github.com/ngxson/wllama.git "$WLLAMA_COMMIT"
fetch wsrc/llama.cpp https://github.com/ggml-org/llama.cpp.git "$LLAMA_COMMIT"
# idempotent (re-applying would touch files and force a relink); rm -rf "$WORK/wsrc" for a clean tree
# tools/wllama-patches/*.patch apply to wllama, tools/wllama-patches/llama.cpp/*.patch to its llama.cpp
apply_patches() { # repo-dir patch...
  local dir=$1 p; shift
  for p in "$@"; do
    [ -f "$p" ] || continue
    if git -C "$dir" apply --ignore-whitespace --reverse --check "$(native "$p")" 2>/dev/null; then echo "already applied $(basename "$p")"
    else git -C "$dir" apply --ignore-whitespace "$(native "$p")"; echo "applied $(basename "$p")"; fi
  done
}
apply_patches wsrc "$ROOT"/tools/wllama-patches/*.patch
apply_patches wsrc/llama.cpp "$ROOT"/tools/wllama-patches/llama.cpp/*.patch

# --- toolchain ---------------------------------------------------------------
unzip_to() { python -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$(native "$1")" "$(native "$2")"; }
if [ ! -f emsdk/emsdk.py ]; then rm -rf emsdk && git clone -q --depth 1 https://github.com/emscripten-core/emsdk.git emsdk; fi
(cd emsdk && ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh >/dev/null 2>&1
CMAKE=$(command -v cmake || ls "$WORK"/tools/cmake-*/bin/cmake.exe 2>/dev/null | head -1 || true)
NINJA=$(command -v ninja || ls "$WORK"/tools/ninja.exe 2>/dev/null | head -1 || true)
if [ -z "$CMAKE" ] || [ -z "$NINJA" ]; then
  mkdir -p tools
  curl -sfL -o tools/cmake.zip https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-windows-x86_64.zip
  curl -sfL -o tools/ninja.zip https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip
  unzip_to tools/cmake.zip tools && unzip_to tools/ninja.zip tools && rm tools/cmake.zip tools/ninja.zip
  CMAKE=$(ls "$WORK"/tools/cmake-*/bin/cmake.exe | head -1); NINJA="$WORK/tools/ninja.exe"
fi

if [ ! -d wsrc/build/emdawn/emdawnwebgpu_pkg ]; then
  mkdir -p wsrc/build/emdawn
  curl -sL -o wsrc/build/emdawn.zip "https://github.com/google/dawn/releases/download/$DAWN_TAG/emdawnwebgpu_pkg-$DAWN_TAG.zip"
  unzip_to wsrc/build/emdawn.zip wsrc/build/emdawn
fi

# --- build (same flags as wllama CI, Ninja instead of make) --------------------
cd wsrc
# (emcmake is only a .bat/.py on Windows; passing the toolchain file is what it does)
# file-prefix-map: assert messages carry source paths; keep the local checkout path out of the shipped wasm
PREFIX_MAP="-ffile-prefix-map=$(native "$WORK/wsrc")=/wllama"
# shellcheck disable=SC2086
"$CMAKE" -S . -B "$BUILD_DIR" -G Ninja -DCMAKE_MAKE_PROGRAM="$(native "$NINJA")" \
  -DCMAKE_C_FLAGS="$PREFIX_MAP" -DCMAKE_CXX_FLAGS="$PREFIX_MAP" \
  -DCMAKE_TOOLCHAIN_FILE="$(native "$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake")" \
  -DCMAKE_CROSSCOMPILING_EMULATOR="$(native "$EMSDK_NODE")" \
  -DGGML_WEBGPU=ON -DGGML_WEBGPU_JSPI=ON -DEMDAWNWEBGPU_DIR="$(native "$WORK/wsrc/build/emdawn/emdawnwebgpu_pkg")" \
  -DWLLAMA_TEST_BACKEND=OFF $EXTRA_CMAKE_ARGS
"$CMAKE" --build "$BUILD_DIR" --target wllama -j "$JOBS"
ls -l "$BUILD_DIR"/wllama.js "$BUILD_DIR"/wllama.wasm
EXTRA_CMAKE_ARGS="$EXTRA_CMAKE_ARGS" python - "$(native "$BUILD_DIR"/BUILD.json)" "$WLLAMA_COMMIT" "$LLAMA_COMMIT" "$EMSDK_VERSION" "$DAWN_TAG" $(cd "$ROOT/tools/wllama-patches" && ls *.patch llama.cpp/*.patch 2>/dev/null) <<'PY'
import json, os, sys, datetime
out, wl, lc, em, dawn, *patches = sys.argv[1:]
meta = {'wllama': wl, 'llama.cpp': lc, 'emsdk': em, 'emdawnwebgpu': dawn, 'patches': patches,
        'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
if os.environ.get('EXTRA_CMAKE_ARGS'):
    meta['cmakeArgs'] = os.environ['EXTRA_CMAKE_ARGS']  # a test variant, not for shipping
json.dump(meta, open(out, 'w'), indent=2)
PY
cat "$BUILD_DIR"/BUILD.json
