#!/usr/bin/env bash
set -euo pipefail
umask 077

test -f /.dockerenv
build_root="$HOME/monero-gate-a"
mkdir -p "$build_root/inputs"
cd "$build_root"

checkout() {
  local directory=$1
  local repository=$2
  local revision=$3
  if [ ! -d "$directory/.git" ]; then
    git init -q "$directory"
    timeout 600 git -C "$directory" fetch --quiet --depth 1 "$repository" "$revision"
    git -C "$directory" checkout --quiet --detach FETCH_HEAD
  fi
  test "$(git -C "$directory" rev-parse HEAD)" = "$revision"
  git -C "$directory" diff --exit-code
}

download() {
  local filename=$1
  local url=$2
  local maximum_bytes=$3
  if [ ! -f "inputs/$filename" ]; then
    curl -fLsS --proto '=https' --proto-redir '=https' \
      --connect-timeout 20 --max-time 300 --retry 1 --max-filesize "$maximum_bytes" \
      -o "inputs/$filename.partial" "$url"
    mv "inputs/$filename.partial" "inputs/$filename"
  fi
}

checkout monero-ts https://github.com/woodser/monero-ts.git f6569ca616c4723645a7bfae3a843a0358f5fca9
timeout 900 git -C monero-ts submodule update --init --recursive --depth 1 --jobs 4
checkout emsdk https://github.com/emscripten-core/emsdk.git 35659964bc2762fffec0d257997fb61475f765b7
(
  cd emsdk
  timeout 900 ./emsdk install 6.0.13
  ./emsdk activate 6.0.13
)

git -C monero-ts apply --check /opt/wallet-build/native-build.patch
git -C monero-ts apply /opt/wallet-build/native-build.patch
cpp=monero-ts/external/monero-cpp
git -C "$cpp" apply --check /opt/wallet-build/native-wallet.patch
git -C "$cpp" apply /opt/wallet-build/native-wallet.patch
core=monero-ts/external/monero-cpp/external/monero-project
git -C "$core" apply --check /opt/wallet-build/native-core.patch
git -C "$core" apply /opt/wallet-build/native-core.patch

download boost_1_83_0.tar.gz https://archives.boost.io/release/1.83.0/source/boost_1_83_0.tar.gz 160000000
download unbound-1.22.0.tar.gz https://nlnetlabs.nl/downloads/unbound/unbound-1.22.0.tar.gz 20000000
download openssl-3.5.9.tar.gz https://github.com/openssl/openssl/releases/download/openssl-3.5.9/openssl-3.5.9.tar.gz 60000000
download libsodium-1.0.18-LICENSE https://raw.githubusercontent.com/jedisct1/libsodium/1.0.18/LICENSE 8192
download easyloggingpp-9.96.7-LICENSE https://raw.githubusercontent.com/abumq/easyloggingpp/v9.96.7/LICENSE 8192
(
  cd inputs
  sha256sum -c <<'CHECKSUMS'
dea1855c9809f3faf22aa4a1fba20ec8af5a5587f23115012e5b98279cedc4af  libsodium-1.0.18-LICENSE
bd30b865b9808a6637145bf02df92c06b0c21307e170f4bdf30b2e277f6cda35  easyloggingpp-9.96.7-LICENSE
CHECKSUMS
)

bash /opt/wallet-build/build-native-wasm.sh
