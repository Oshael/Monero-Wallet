# Offline Manifest V3 wallet probe

This Gate A probe loads the published `monero-ts@0.11.22` worker with its embedded WASM. The extension page owns the worker lifecycle. It creates a temporary stagenet wallet, closes and terminates its worker, then restores the generated seed in a new worker and compares primary addresses. The page reports only timing and the WASM heap size. It does not accept wallet input, persist data, request host permissions or connect to a node.

## Reproduce

From the project root, stage the extension in a temporary directory using npm, `tar` and `shasum`.

```sh
(
  set -eu
  probe_source="$PWD/experiments/wallet-mv3"
  probe_dir=$(mktemp -d)
  cd "$probe_dir"
  npm pack monero-ts@0.11.22 --ignore-scripts --quiet --cache ./npm-cache
  printf '%s\n' '8fe1848c406586ba2ff7170e5d6d53a405a9dfe1f4655552b24c546aede1ff8f  monero-ts-0.11.22.tgz' | shasum -a 256 -c
  tar -xzf monero-ts-0.11.22.tgz package/LICENSE.txt package/dist/monero.worker.js package/dist/monero.worker.js.LICENSE.txt
  mkdir extension
  cp "$probe_source/manifest.json" "$probe_source/probe.html" "$probe_source/probe.mjs" extension/
  cp package/dist/monero.worker.js package/dist/monero.worker.js.LICENSE.txt extension/
  cp package/LICENSE.txt extension/monero-ts.LICENSE.txt
  printf 'Load unpacked from %s/extension\n' "$probe_dir"
)
```

In a fresh Chromium profile, open `chrome://extensions`, enable Developer mode, and load the printed directory using **Load unpacked**. Copy the extension ID and open `chrome-extension://<extension-id>/probe.html`. The result should report that stagenet creation and restore passed. Reload the page to repeat with a new disposable wallet.

## Observed result

Chrome for Testing `156.0.8078.4` ran the unpacked extension with the declared CSP in a fresh headless profile. Creation and restore took 12.7 s on the initial load and 7.1 s after a page reload. The worker reported 23,658,496 bytes of WASM heap after creation. The first run left no active page worker, Local Storage entries or IndexedDB databases at completion. The timings are from two runs in one browser session. The heap measurement excludes browser and JavaScript memory.

The npm tarball integrity matched registry metadata. The worker, standalone WASM glue and included notices matched their published Git artifacts byte for byte. The package uses MIT and the worker includes additional dependency notices. This comparison establishes which published bundle was tested. Independent compilation and a complete license and provenance inventory remain Gate A work. The upstream build uses Emscripten 3.1.66 in CI and invokes a script that clears an Emscripten cache under the current home directory. Rebuild in an isolated environment. [Pinned upstream commit](https://github.com/woodser/monero-ts/tree/f6569ca616c4723645a7bfae3a843a0358f5fca9)

## Independent recovery and browser entropy

The test runner creates a fresh stagenet wallet in the MV3 worker and gives its disposable 25-word mnemonic to the official Monero CLI through standard input. The CLI runs in offline mode. Its output is discarded because wallet creation prints a private view key. The runner compares the addresses locally, rejects a mnemonic with a changed checksum word and removes its temporary profile and wallet files. A test-only worker wrapper observes `crypto.getRandomValues` during wallet creation and checks that creation fails when the entropy call throws.

Both recovery checks and both entropy checks passed with Monero CLI `0.18.5.4` and Chrome for Testing `156.0.8078.4`. The CLI archive matched the SHA-256 in the signed release manifest after verification against the fingerprint in the official verification guide. This establishes the tested offline seed format and entropy behavior. Independent recovery of a funded wallet, backup persistence, synchronization and transfers remain pending. [Official CLI release](https://github.com/monero-project/monero/releases/tag/v0.18.5.4) · [Binary verification guide](https://www.getmonero.org/resources/user-guides/verification-allos-advanced.html)

To repeat the check, use the temporary directory staged in **Reproduce**. Verify the official CLI download and extract `monero-wallet-cli` into that directory, next to `extension/`. Use a local Playwright installation and a Chromium executable that supports unpacked extensions in headless mode. The test used Playwright `1.62.1`. Run the following from the project root with `probe_dir` set to the staged directory.

```sh
cp experiments/wallet-mv3/recovery.cjs "$probe_dir/"
cp experiments/wallet-mv3/entropy-worker.js "$probe_dir/extension/"
node "$probe_dir/recovery.cjs" /absolute/path/to/playwright /absolute/path/to/chromium
```

The runner uses the private upstream worker message format in a test profile. It emits only the browser version, mnemonic word count and test outcomes.

## Dependency review

- The package commit pins `monero-cpp` at `4c9485daaed03261c0ba7103b0fca44a65948077`. Its `external/monero-project` gitlink resolves to `3e9d5d24d52b2427ace10c115e13c58df90ef796`. These revisions are inputs for the build review. The release artifact's correspondence to a clean rebuild remains unverified. [Package commit](https://github.com/woodser/monero-ts/tree/f6569ca616c4723645a7bfae3a843a0358f5fca9) · [C++ submodule](https://github.com/woodser/monero-cpp/tree/4c9485daaed03261c0ba7103b0fca44a65948077)
- The published worker source map identifies 91 distinct `node_modules` paths, including nested copies. The pinned lockfile declares 77 MIT, two BSD-3-Clause, three ISC and one combined MIT/BSD-3-Clause entries. Exact-version npm metadata lists four MIT, one ISC, two Apache-2.0 and one 0BSD entries for the eight remaining paths. These are declared licenses for identified JavaScript modules. Native component notices and a full distribution review remain pending. [Upstream lockfile](https://github.com/woodser/monero-ts/blob/f6569ca616c4723645a7bfae3a843a0358f5fca9/package-lock.json)
- The default upstream build prepares OpenSSL `1.1.1q`, a release series outside public security support. The WASM target's explicit OpenSSL link entries are commented out. Its presence in the build recipe is confirmed. The runtime linkage and exact provenance of the native components in the published artifact remain unverified. [Download script](https://github.com/woodser/monero-ts/blob/f6569ca616c4723645a7bfae3a843a0358f5fca9/bin/download_deps.sh#L168) · [WASM target](https://github.com/woodser/monero-ts/blob/f6569ca616c4723645a7bfae3a843a0358f5fca9/CMakeLists.txt#L342) · [OpenSSL support notice](https://mirror.openssl-library.org/post/2023-06-15-1.1.1-eol-reminder/)
- The worker source map and lockfile identify `axios@1.7.4` and `elliptic@6.5.7`, versions covered by advisories for absolute URL handling and ECDSA signing, respectively. The worker bundles both packages. Exploitability in the intended Monero RPC and signing paths remains unverified. [Axios advisory](https://github.com/axios/axios/security/advisories/GHSA-jr5f-v2jv-69x6) · [Elliptic advisory](https://github.com/advisories/GHSA-vjh7-7g9h-fjfh)

## Project worker build

The upstream review found `0.11.22` at the npm `latest` tag. The upstream default branch at `df966246809259850056f7a26f84563c46f22e23` used the same dependency lock, browser bundler configuration and OpenSSL recipe as the release. The `fix_vulnerabilities` branch is an older `0.10.0` revision that still uses the affected Axios and elliptic versions and the old OpenSSL recipe. The open pull requests inspected did not address these findings. [Release](https://github.com/woodser/monero-ts/releases/tag/v0.11.22) · [Older security branch](https://github.com/woodser/monero-ts/commit/436174dcf6832df25295c1418cca5ee2b5bc1185) · [Pull requests](https://github.com/woodser/monero-ts/pulls)

The [worker patch](worker-build.patch) pins `axios@1.21.0` and the URL shim's `qs@6.17.1`. It omits Node's crypto polyfill from the browser worker. That removes `elliptic`, `cipher-base`, `pbkdf2` and `sha.js` from the worker. The patch changes dependency resolution and Webpack configuration. It uses the same native WASM payload verified in the first probe. [Axios release](https://github.com/axios/axios/releases/tag/v1.21.0) · [qs changes](https://github.com/ljharb/qs/blob/v6.17.1/CHANGELOG.md)

### Reproduce the project build

The worker was built with Node `24.14.0` and npm `11.9.0`. Run from the project root and use the resulting `build_dir` as the staging directory for the browser checks.

```sh
project_root="$PWD"
build_dir=$(mktemp -d)
(
  set -eu
  git clone --depth 1 --branch v0.11.22 https://github.com/woodser/monero-ts.git "$build_dir/source"
  cd "$build_dir/source"
  test "$(git rev-parse HEAD)" = f6569ca616c4723645a7bfae3a843a0358f5fca9
  git apply --check --whitespace=error "$project_root/experiments/wallet-mv3/worker-build.patch"
  git apply "$project_root/experiments/wallet-mv3/worker-build.patch"
  npm ci --ignore-scripts --no-audit --no-fund --cache ../npm-cache
  npm run build_web_worker --offline --cache ../npm-cache
  node "$project_root/experiments/wallet-mv3/verify-worker.mjs" .
)
```

For the independent recovery check, copy `manifest.json`, `probe.html`, `probe.mjs` and `entropy-worker.js` into `build_dir/extension/`. Copy `monero.worker.js` and `monero.worker.js.LICENSE.txt` from `build_dir/source/dist/` and save `build_dir/source/LICENSE.txt` as `build_dir/extension/monero-ts.LICENSE.txt`. Stage the CLI and `recovery.cjs` as described under **Independent recovery and browser entropy**. For the RPC fixture, copy `check-worker-rpc.cjs` to `build_dir` and run it with the same Playwright and Chromium paths as the recovery runner. It starts a temporary loopback server and uses a separate test manifest restricted to that origin.

### Verification boundary

A clean reinstall and rebuild reproduced the 3,203,080-byte worker with SHA-256 `96edcc6a9de691b7c55df391704864e0aadad333b0aaca5c3b3a090040e4a384`. Type checking passed. Webpack emitted size warnings. The worker's embedded WASM matched the published payload byte for byte. The Chromium recovery and entropy checks passed again with the rebuilt worker and the official CLI.

The loopback RPC fixture passed JSON response handling, binary request and response, and HTTP 503 handling. A separate HTTP Digest challenge timed out with both the upstream and project workers in headless Chromium. Authenticated RPC compatibility remains unverified.

`npm audit signatures --omit=dev` passed for the declared production dependency graph. The full `npm audit` still reported 26 findings. Cross-checking the reported package paths against the candidate worker source map found no matches. This is a dependency scan and source map comparison. The build and test toolchain and the native code require separate review before adopting the candidate.

## Native source rebuild

Run [the native build script](build-native-wasm.sh) inside a fresh Linux VM with no host project mounts. It builds the pinned C++ sources, captures the linker map and stages `monero.js` in the VM. The native compiler follows the upstream Emscripten `3.1.66` baseline. This version's bundled Node `18.20.3` is used only for the isolated toolchain and postprocessing. A maintained release toolchain remains a separate review item. [Upstream CI recipe](https://github.com/woodser/monero-ts/blob/f6569ca616c4723645a7bfae3a843a0358f5fca9/.github/workflows/ci.yml#L52)

In the guest, install the packages in the upstream `dist` job and add `git`, `curl`, `ca-certificates` and `xz-utils`. Prepare this directory structure under `~/monero-gate-a`:

- `monero-ts/` contains the upstream `f6569ca616c4723645a7bfae3a843a0358f5fca9` checkout with its recursive submodules initialized at their recorded revisions.
- `emsdk/` contains SDK source `a72a42afc3700174023ade6bf83aa79892bb783c` with `./emsdk install 3.1.66` and `./emsdk activate 3.1.66` completed.
- `inputs/` contains `boost_1_83_0.tar.gz`, `unbound-1.22.0.tar.gz` and `openssl-3.5.9.tar.gz`. The script checks their SHA-256 values before extraction. [Boost archive metadata](https://archives.boost.io/release/1.83.0/source/boost_1_83_0.tar.gz.json) · [Unbound releases](https://www.nlnetlabs.nl/projects/unbound/download/) · [OpenSSL 3.5.9](https://github.com/openssl/openssl/releases/tag/openssl-3.5.9)

Run `bash build-native-wasm.sh` in the guest. The script generates OpenSSL 3.5.9 headers and leaves the upstream WASM target's OpenSSL link entries disabled. It does not invoke the upstream OpenSSL 1.1.1q build script. It saves the native link map as `~/monero-gate-a/wasm-link.map`.

Copy the staged `monero.js` out of the guest. In a staging tree with the worker patch applied, replace `source/dist/monero.js`, run `npm run build_web_worker` and pass the SHA-256 from the native build to `node verify-worker.mjs source <native-glue-sha256>`. The verifier checks that the worker contains the same WASM bytes as that artifact. Use the recovery and loopback fixtures above with the resulting worker. Secure persistence and real node synchronization require separate evidence.

### Remote container build

The [native Dockerfile](Dockerfile.native) installs its toolchain prerequisites inside an Ubuntu container. The [preparation script](prepare-native-wasm.sh) fetches pinned source revisions and size-bounded archives, then runs the native build. The Docker context allowlist includes only the build recipe and these scripts.

Build the image from `experiments/wallet-mv3`. Run it with a dedicated work directory mounted at `/root/monero-gate-a`, explicit CPU and memory limits and no published ports. Set `WALLET_BUILD_JOBS` from 1 to 4. The build downloads its dependencies through the container network. Record the source commit, image ID, resource limits, artifact hashes and relevant service health checks in ignored local operational records. Verify existing services and configuration fingerprints before and after the run.

The owner interrupted the Mac VM compile before it produced a final native artifact and moved this work to the VPS. Source synchronization authorizes this isolated experiment. Deployment remains a separate delivery step.
