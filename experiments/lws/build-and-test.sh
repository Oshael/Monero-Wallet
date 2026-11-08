#!/usr/bin/env bash
set -euo pipefail
# Run inside the isolated build image, with a project-only checkout mounted here.
source_dir=${1:?Usage: build-and-test.sh CHECKOUT}
cmake -S "$source_dir" -B "$source_dir/build" \
  -DBUILD_TESTS=ON -DBUILD_GUI_DEPS=OFF -DBUILD_DOCUMENTATION=OFF \
  -DBUILD_SHARED_LIBS=OFF -DMANUAL_SUBMODULES=ON \
  -DUSE_DEVICE_TREZOR=OFF -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,noexecstack
cmake --build "$source_dir/build" \
  --target monero-lws-daemon monero-lws-admin monero-lws-unit wallet-lws-storage-probe wallet-lws-rest-fixture -j "${BUILD_JOBS:-4}"
ctest --test-dir "$source_dir/build" --output-on-failure
for binary in src/monero-lws-daemon src/monero-lws-admin tests/unit/monero-lws-unit tests/unit/wallet-lws-storage-probe tests/unit/wallet-lws-rest-fixture; do
  readelf -W -l "$source_dir/build/$binary" | awk '/GNU_STACK/ {seen=1; if ($7 ~ /E/) bad=1} END {exit (!seen || bad)}'
done
