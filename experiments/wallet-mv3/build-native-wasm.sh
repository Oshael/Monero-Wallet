#!/usr/bin/env bash
set -eo pipefail
umask 077

test "$(uname -s)" = Linux
build_jobs=${WALLET_BUILD_JOBS:-2}
if ! [[ "$build_jobs" =~ ^[1-9][0-9]*$ ]] || [ "$build_jobs" -gt 4 ]; then
  echo 'WALLET_BUILD_JOBS must be an integer from 1 to 4.' >&2
  exit 1
fi
cd "$HOME/monero-gate-a"
build_root=$PWD
test "$(git -C emsdk rev-parse HEAD)" = a72a42afc3700174023ade6bf83aa79892bb783c
source emsdk/emsdk_env.sh
export EMSCRIPTEN="$EMSDK/upstream/emscripten"
emcc --version | grep -F ' 3.1.66 '
export LC_ALL=C
export TZ=UTC

source_dir="$build_root/monero-ts"
monero_cpp="$source_dir/external/monero-cpp"
monero_core="$monero_cpp/external/monero-project"
test "$(git -C "$source_dir" rev-parse HEAD)" = f6569ca616c4723645a7bfae3a843a0358f5fca9
SOURCE_DATE_EPOCH=$(git -C "$source_dir" show -s --format=%ct HEAD)
export SOURCE_DATE_EPOCH
test "$(git -C "$monero_cpp" rev-parse HEAD)" = 4c9485daaed03261c0ba7103b0fca44a65948077
test "$(git -C "$monero_core" rev-parse HEAD)" = 3e9d5d24d52b2427ace10c115e13c58df90ef796
git -C "$source_dir" submodule status --recursive > submodule-pins.txt
if grep -q '^[+-U]' submodule-pins.txt; then
  echo 'An upstream submodule is missing or does not match its recorded revision.' >&2
  exit 1
fi

step() {
  local label=$1
  shift
  printf 'Starting %s\n' "$label"
  if ! "$@" > "$build_root/$label.log" 2>&1; then
    tail -45 "$build_root/$label.log"
    return 1
  fi
  printf 'Completed %s\n' "$label"
}

extract_inputs() {
  cd "$build_root/inputs"
  sha256sum -c <<'CHECKSUMS'
c0685b68dd44cc46574cce86c4e17c0f611b15e195be9848dfd0769a0a207628  boost_1_83_0.tar.gz
c5dd1bdef5d5685b2cedb749158dd152c52d44f65529a34ac15cd88d4b1b3d43  unbound-1.22.0.tar.gz
603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a  openssl-3.5.9.tar.gz
CHECKSUMS
  mkdir -p "$monero_cpp/external/boost-sdk"
  tar -xzf boost_1_83_0.tar.gz -C "$monero_cpp/external/boost-sdk" --strip-components=1
  tar -xzf unbound-1.22.0.tar.gz -C "$HOME"
  tar -xzf openssl-3.5.9.tar.gz -C "$build_root"
}

prepare_openssl_headers() {
  local openssl_source="$build_root/openssl-3.5.9"
  cd "$openssl_source"
  perl ./Configure linux-generic32 no-asm no-shared no-threads no-tests
  make -j"$build_jobs" build_generated
  mkdir -p "$source_dir/build/openssl"
  ln -sfn "$openssl_source/include" "$source_dir/build/openssl/include"
}

generate_monero_headers() {
  cmake -S "$monero_core" -B "$monero_core/build/release" \
    -D CMAKE_BUILD_TYPE=Release -D MONERO_WALLET_CRYPTO_LIBRARY=cn
  cmake --build "$monero_core/build/release" --target generate_translations_header --parallel "$build_jobs"
}

compile_boost() {
  cd "$source_dir"
  ./bin/build_boost_emscripten.sh
}

compile_wasm() {
  cd "$source_dir"
  emcmake cmake -S . -B build -D "CMAKE_EXE_LINKER_FLAGS=-Wl,-Map=$build_root/wasm-link.map"
  cmake --build build --parallel "$build_jobs"
}

stage_wasm() {
  cd "$source_dir"
  ./bin/postprocess_wasm.sh
  install -m 600 build/monero.js "$build_root/monero.js"
}

step extract-inputs extract_inputs
step openssl-headers prepare_openssl_headers
step monero-headers generate_monero_headers
step boost-wasm compile_boost
step native-wasm compile_wasm
step stage-wasm stage_wasm
sha256sum "$build_root/monero.js"
df -h .
