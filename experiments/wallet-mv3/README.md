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

The [worker patch](worker-build.patch) pins `axios@1.21.0` and the URL shim's `qs@6.17.1`. It omits Node's crypto polyfill from the browser worker. That removes `elliptic`, `cipher-base`, `pbkdf2` and `sha.js` from the worker. The patch also selects the browser fetch transport with ambient credentials omitted, allowing the existing library to handle HTTP Digest challenges. Node's adapter selection and the upstream Digest calculation remain unchanged. The initial worker experiment used the published native payload; the native rebuild below replaces that payload. [Axios release](https://github.com/axios/axios/releases/tag/v1.21.0) · [qs changes](https://github.com/ljharb/qs/blob/v6.17.1/CHANGELOG.md)

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

A clean reinstall and rebuild before the browser transport correction reproduced the 3,203,080-byte worker with SHA-256 `96edcc6a9de691b7c55df391704864e0aadad333b0aaca5c3b3a090040e4a384`. Type checking passed. Webpack emitted size warnings. The worker's embedded WASM matched the published payload byte for byte. The Chromium recovery and entropy checks passed again with the rebuilt worker and the official CLI.

The loopback RPC fixture passed JSON response handling, binary request and response, and HTTP 503 handling. A separate HTTP Digest challenge initially timed out with both the upstream and project workers in headless Chromium. The authenticated daemon regression below records the diagnosis and corrected candidate.

`npm audit signatures --omit=dev` passed for the declared production dependency graph. The full `npm audit` still reported 26 findings. Cross-checking the reported package paths against the candidate worker source map found no matches. This is a dependency scan and source map comparison. The build and test toolchain and the native code require separate review before adopting the candidate.

## Native source rebuild

The current recipe and JavaScript patch target Emscripten 6.0.13. The earlier
3.1.66 results below are historical evidence, not the current shipped artifact.
See [current wallet development](../../docs/WALLET_DEVELOPMENT.md) for the matched
native patches, public ESM client and required notice generation.

### Current maintained-toolchain result

An incremental build and a clean build from the pinned source trees both produced
native glue SHA-256 `9bb13c472522c1b46976a104769816e99bdfb98ed91e0f9f03d24ec11a5a5083`.
The embedded WASM SHA-256 is
`449a42d7773cc8f1f19fe4430fe1f480d2a1cf278f67da12d504eff59659d232`;
the classic worker is `7999ced4c6da4512c54d9981ace29312e6b00ba43c1036d22037f43fd2bd4e39`.
The final source-map comparison found 62 JavaScript package roots and no matches
with the 26 advisories in the full development dependency graph. Full license
texts for those packages and 19 native notices are generated beside the engine.
This does not audit the fork, native parsers or build tools. Cache compatibility,
entropy, CLI recovery, request budgets and funded regtest contracts passed; live
stagenet and large-history client measurements remain separate pending work.

Run [the native build script](build-native-wasm.sh) inside a prepared, isolated
Linux build environment. It builds pinned C++ sources, captures the linker map
and stages `monero.js`. The current compiler is Emscripten `6.0.13` with its bundled
Node `24.19.0`, used only inside the build environment. The historical upstream
baseline was Emscripten `3.1.66` with Node `18.20.3`.
[Upstream baseline](https://github.com/woodser/monero-ts/blob/f6569ca616c4723645a7bfae3a843a0358f5fca9/.github/workflows/ci.yml#L52)

In the guest, install the packages in the upstream `dist` job and add `git`, `curl`, `ca-certificates` and `xz-utils`. Prepare this directory structure under `~/monero-gate-a`:

- `monero-ts/` contains the upstream `f6569ca616c4723645a7bfae3a843a0358f5fca9` checkout with its recursive submodules initialized at their recorded revisions.
- `emsdk/` contains SDK source `35659964bc2762fffec0d257997fb61475f765b7` with `./emsdk install 6.0.13` and `./emsdk activate 6.0.13` completed.
- `inputs/` contains `boost_1_83_0.tar.gz`, `unbound-1.22.0.tar.gz` and `openssl-3.5.9.tar.gz`. The script checks their SHA-256 values before extraction. [Boost archive metadata](https://archives.boost.io/release/1.83.0/source/boost_1_83_0.tar.gz.json) · [Unbound releases](https://www.nlnetlabs.nl/projects/unbound/download/) · [OpenSSL 3.5.9](https://github.com/openssl/openssl/releases/tag/openssl-3.5.9)

Apply the base patches and the additional `native-light-*.patch` adapters to their owning repositories, and copy the project light-data source exactly as shown by
`prepare-native-wasm.sh`, then run `bash build-native-wasm.sh` in the isolated
environment. The script generates OpenSSL 3.5.9 headers and leaves the WASM
target's OpenSSL link entries disabled. It does not invoke the upstream OpenSSL
1.1.1q build script. It saves the link map as `~/monero-gate-a/wasm-link.map`.

Copy the staged `monero.js` out of the guest. In a staging tree with `worker-build.patch` and then `worker-light-build.patch` applied, replace `source/dist/monero.js`, run `npm run build_web_worker` and pass the SHA-256 from the native build to `node verify-worker.mjs source <native-glue-sha256>`. The verifier checks that the worker contains the same WASM bytes as that artifact. Use the recovery and loopback fixtures above with the resulting worker. Secure persistence and real node synchronization require separate evidence.

### Remote container build

The [native Dockerfile](Dockerfile.native) installs prerequisites inside an Ubuntu
container. The [preparation script](prepare-native-wasm.sh) fetches pinned source
revisions, patches and size-bounded archives, then runs the native build. The
Docker context allowlist includes only the recipe, patches and scripts.

Build the image from `experiments/wallet-mv3`. Run it with a dedicated work
directory at `/root/monero-gate-a` and no published ports. Follow the project's
current owner-approved resource policy. Set compiler `WALLET_BUILD_JOBS` from
1 to 4. Downloads use the container network. Record source commit, image ID,
resource settings, hashes and preservation checks in ignored operational records.

The owner interrupted the Mac VM compile before it produced a final native artifact and moved this work to the VPS. Source synchronization authorizes this isolated experiment. Deployment remains a separate delivery step.

### Native build results

The native compile from source commit `43052c3f6b40d977fb29e4b628939c584e3633be` completed in the isolated Linux container. Its inputs were the pinned Monero sources, Emscripten `3.1.66`, Boost `1.83.0` and the verified archives above. The worker assembly passed TypeScript checking and used Node `24.18.1` with the project dependency patch. The native artifact differs from the previously published upstream artifact.

| Artifact                                                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Generated `monero.js` glue                                  | `8e3ad071c941ecf7ad84e1b7410d1909b715f39481f3f2febc6cf34555c8c5a0` |
| Embedded WASM, 6,071,538 bytes                              | `46eb59a5b469d403193fb7b66ae0e2710140239d0bd0e72fffc939997f9b7a15` |
| Worker before browser transport correction, 3,214,926 bytes | `398a6bc8d6ca0700b660d0c98cdb90a42652c02a0df172dc466c2cd258648630` |
| Worker with browser transport correction, 3,215,042 bytes   | `f76140f4b3264ea4ebd17a001325b99b230b8c6322eb63aac322c5412b7a590b` |

The worker verifier confirmed the embedded payload matches the native artifact, Axios is `1.21.0`, qs is `6.17.1` and the excluded Node crypto packages are absent from the source map. The native linker command and map contained no `libssl` or `libcrypto` references. The linker reported seven undefined symbols whose names also occur in the published upstream glue. A subsequent glue inventory found 13 aborting missing-function stubs in total, including those seven; see the remaining-path review below.

The existing recovery and RPC fixtures passed with Playwright `1.62.1`, Chromium `151.0.7922.34` and the signature-verified official Monero CLI `0.18.5.4`. They covered creation and same-engine restoration, independent CLI address recovery, modified mnemonic checksum rejection, browser entropy use and rejection on entropy failure, JSON, binary request/response and HTTP 503 handling. These tests used disposable stagenet wallets. The browser container ran as `pwuser` with its Chromium sandbox enabled and external networking disabled. Compare the image's actual UID and GID before assigning ownership of the test directory. The first launch used a mismatched UID and failed to load Playwright. The corrected launch completed with exit zero.

Native, worker and browser stages completed with exit zero. The project builder was stopped after recording the artifacts. Configuration fingerprints matched the pre-build baseline and the previously running services and containers remained active. Operational evidence and image identifiers are kept in ignored local records.

Only one native compilation was completed. Native byte-for-byte reproducibility, a maintained release toolchain, complete native license review, unresolved native paths, persistence, realistic synchronization, transfers and interruption recovery still require evidence.

### Authenticated daemon regression

The browser XHR adapter stalled on the HTTP 401 Digest challenge. A diagnostic browser profile with test-only HTTP credentials let the challenge complete and the existing library retry succeed. The project patch selects Axios's fetch adapter for browser requests and sets `withCredentials: false` on both the initial request and its Digest retry. Browser ambient authentication is omitted, and the library continues to construct its Digest Authorization header. No browser-level HTTP credentials are configured in the regression runner.

The [daemon runner](check-wallet-daemon.cjs) starts the signature-verified official `monerod` `0.18.5.4` in offline regtest mode. Its RPC binds only to loopback and requires disposable test credentials. A separate MV3 profile allows connections only to that loopback origin. The runner owns daemon shutdown, worker termination and temporary profile/chain removal. Test credentials are fixed public fixtures and never used for a deployed service.

The permanent runner failed with an `httpRequest` timeout on the worker before the correction and passed with the corrected worker. It observed HTTP 200 and daemon status `OK` for the correct password, HTTP 401 for a wrong password, an authenticated wallet connection and wallet/daemon height 1 after synchronization. JSON, binary and HTTP 503 fixtures also passed. Independent CLI recovery, mnemonic checksum rejection and both entropy checks passed with the corrected candidate. Type checking and the worker artifact verifier passed; the native WASM hash was unchanged. The complete patch applied cleanly to the pinned upstream source and matched all four tested input files.

To reproduce, stage the project-built worker under `build_dir/source/dist/`. Extract `monerod` from the same verified official Linux release archive used for CLI recovery, place it at `build_dir/monerod` and make it executable. Run as an unprivileged user in a disposable container with external networking disabled, no published ports and explicit CPU, memory and process limits. The recorded run used two CPUs, 4 GiB memory, Playwright `1.62.1`, Chromium `151.0.7922.34` and its enabled sandbox. Check fixture ownership against the container user's actual UID/GID before running.

```sh
cp experiments/wallet-mv3/check-wallet-daemon.cjs "$build_dir/"
node "$build_dir/check-wallet-daemon.cjs" /absolute/path/to/playwright /absolute/path/to/chromium
```

This proves the tested browser Digest transport and a one-block fake-chain wallet flow. Funded stagenet behavior, representative synchronization, proxies/TLS and other supported browser versions need their own validation. The runner uses the private upstream worker message format; public wallet API validation remains pending.

### Remaining native paths

The generated native glue contains 13 `abort("missing function: ...")` stubs. All 13 names also occur among the 14 stubs in the published glue. This comparison identifies inherited limitations; it does not establish that a missing function is unreachable. The seven linker diagnostics alone were an incomplete inventory.

| Missing functions                                                                                     | Source investigation and remaining validation                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rx_seedheight`, `rx_slow_hash`, `v4_generate_JIT_code`, `Blockchain::get_pending_block_id_by_height` | Proof-of-work, RandomX/JIT and blockchain hashing references in the pinned native sources. RPC-payment mining also references slow hashing. Reachability from the proposed browser wallet API still needs review. |
| `file_io_utils::load_file_to_string`, `file_io_utils::save_string_to_file`                            | Called by native wallet file helpers, including cache/key and file-export paths. Validate the browser's data-based export/reopen contract before designing persistent storage.                                    |
| `BIO_free`, `BIO_new_mem_buf`, `CRYPTO_free`, `PEM_read_bio`, `PEM_write`                             | OpenSSL-related stubs remain despite the absence of linked OpenSSL libraries. Native PEM file paths need review; generated headers and successful offline creation do not prove these paths work.                 |
| `hw::trezor::register_all`                                                                            | Hardware-device registration stub; compatibility with device paths is unverified.                                                                                                                                 |
| `tools::Notify::notify`                                                                               | Native transaction-command notification path guarded by the optional notifier. Browser reachability and configuration need review.                                                                                |

The successful tests did not exercise these stubs. Engine adoption remains on hold until the required browser operations have a supported, validated path and the native dependency/license and release-toolchain reviews pass. No substitute cryptographic implementations or success-returning stubs were added.
