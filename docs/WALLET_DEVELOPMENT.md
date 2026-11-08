# Wallet development

Use Node `24.18.1` or newer within the 24.x line and npm `11.16.0`.
Install locked application dependencies with scripts disabled:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
```

`verify` combines typed ESLint, strict TypeScript (application and tests), module
boundaries, Prettier and contract tests. CI repeats it. Generated engine artifacts
are excluded from Git; application checks do not require them.

## Architecture transition

The owner selected VPS-side light scanning. The native recipe includes the
project light-data adapter and matching client methods. The extension selects
light mode only after an explicit scanner selection and view-key consent.
Legacy snapshots remain readable and keep their existing scan mode until that
selection. Follow [the adoption record](LIGHT_WALLET_ADOPTION.md) for the approved
privacy scope, migration and unresolved persistent scanner storage decisions.
Never treat `set_light_wallet(true)` alone as subaddress-compatible integration.

## Native engine and extension artifact

Follow the isolated [native recipe](../experiments/wallet-mv3/README.md#native-build-results).
The current recipe pins Emscripten 6.0.13 and applies `native-build.patch`,
`native-core.patch` and `native-wallet.patch` to their respective repositories.
The light-wallet experiment additionally applies the three `native-light-*.patch`
files and copies `light-wallet/wallet_light_data.cpp` into the core source tree,
as specified by the preparation script. The new importer does not enable the
legacy light-wallet flag or replace native decoy selection.
The downloaded native inputs and legal notices have fixed SHA-256 checks.

In the prepared monero-ts checkout, apply `worker-build.patch` followed by
`worker-light-build.patch` from this repository,
install its patched lockfile with `npm ci --ignore-scripts`, and copy the independently
built `monero.js` into that checkout's `dist/monero.js`. Do not use its published WASM
with the current JavaScript exception bridge. Assemble the public ESM client:

```sh
node experiments/wallet-mv3/build-engine-client.cjs /absolute/path/to/monero-ts "$PWD/vendor"
node experiments/wallet-mv3/collect-client-notices.cjs /absolute/path/to/monero-ts "$PWD/vendor"
node scripts/collect-native-notices.mjs /absolute/path/to/native-workspace "$PWD/vendor"
npm run build
```

The wrapper patch also exposes native view-only key export through
`getData({ viewOnly: true })`. Transaction preparation opens that key file with
the complete cache so RingCT masks remain available. Compact `exportOutputs`
cannot initialize this observer: that native format intentionally omits those
masks. The transaction regression spends a received output as well as coinbase
funding and checks that the observer cannot return a private spend key.

The native workspace contains `monero-ts`, `emsdk`, extracted `openssl-3.5.9` and
the verified `inputs` directory. The notice collector requires those actual
build inputs. Preserve all generated license files alongside the client. The
build adds the full noble-hashes license. The native SHA-256 and matching worker
payload can be verified with `experiments/wallet-mv3/verify-worker.mjs` after
building the classic worker in the patched engine checkout.

Load `dist/` as an unpacked extension in a disposable Chromium profile. It is a
development artifact for stagenet, not an approved public release. The popup
opens the wallet in a full tab. Choose a compatible node explicitly; the extension
requests permission for that origin. HTTPS is required except for loopback test
nodes. No remote executable code or wallet backend is required.

## Browser contracts

Use Playwright `1.62.1` with an unpacked-extension-capable Chromium executable.
Place a copy of the assembled `dist/` at `test/browser/extension` in a disposable
staging directory alongside `wallet-flow.cjs` (do not create a tracked fixture artifact). Run the staged script:

```sh
node /absolute/path/to/staged/wallet-flow.cjs /absolute/path/to/playwright /absolute/path/to/chromium
```

Build `build-pending-recovery.mjs`, copy its generated
`pending-recovery-probe.js` beside the extension files and add a fixture-only
`pending-probe.html`; the UI runner uses it to import a large prepared checkpoint.

The runner owns temporary profiles, encrypted backup files and cleanup. It creates
only disposable wallets, blocks external DNS and reports booleans. It verifies
backup import after deleting that temporary profile's local database, password
rotation, label recovery, worker termination and exclusive session ownership.
`measure-client.cjs` adds sampled browser-process RSS on a local desktop. Summed
RSS can count shared pages more than once and is not a whole-system memory peak.

`build-sync-probe.mjs` and `run-sync.cjs` measure checkpointed restoration against
a disposable authenticated stagenet node exposed only at loopback port 38881.
Stage the probe beside the application's workers and vendor files; grant only
that loopback origin in the fixture manifest. Pass the node's initial height and
desired restore height to the runner. It counts request sizes and samples process
RSS without logging keys or payloads. A trusted synthetic click every minute
keeps this active-user measurement from invoking the normal inactivity lock.
A failed historical scan retains its encrypted fixture profile and bounded run
ledger under the staging directory's ignored `.local/`. After diagnosis, pass the
explicit final `resume` argument to reopen that same profile. The runner refuses
to replace an incomplete run silently and limits attempts; successful completion
removes its disposable profile. Each segment has a 15-minute scan deadline.
Keep the same absolute extension path so Chromium preserves the fixture origin.

The node must be fully synchronized: the native wallet deliberately skips its
scan while the daemon is behind. An empty restored seed does not represent a
wallet with a large received-output history, and stagenet does not establish
mainnet-scale capacity. Report chain height, restore span and dataset alongside
any results; do not report a skipped scan as performance evidence.

For transaction tests, build `test/browser/build-transaction-probe.mjs` and stage
its output with the ESM vendor directory and `run-transactions.cjs`. Use the
official, signature-verified daemon with `daemon-fixture.cjs`, as documented in
the native experiment. Its regtest uses mainnet address encoding but has no real
mainnet connection or monetary value. It has fixed difficulty, local-only RPC and
disposable credentials. It must never reuse a real wallet or live-chain database.

`build-lifecycle-probe.mjs` and `check-lifecycle.cjs` exercise interrupted scans,
node failure, simulated idle/resume locking and background native fatal handling.
Stage their probe, `stagenet-browser.cjs` and `vault-revision.cjs` with a disposable
extension whose manifest grants only the local node. `check-live-receipt.cjs`,
`check-live-transfer.cjs` and `check-live-settlement.cjs` use explicitly staged
disposable funded profiles. Keep addresses, credentials, backups and funding
records ignored. The transfer runner guards against a second initial attempt;
its explicit preparation/signed continuation modes inspect durable state before
proceeding. A response-drop route retries only the same signed bytes. Settlement
waits for both receipt and change to unlock. Never run these against real funds.

## Recovery and limitations

Keep the 25-word seed independently and verify it in the extension. The encrypted
backup also includes scan data, labels and node settings. Previously exported
backups retain their original password after rotation. `unlimitedStorage` protects
extension data from browser eviction; it does not protect against manual removal,
disk failure or a compromised unlocked browser. The current payload budget is
128 MiB and requires validation against representative wallet caches.

After an uncertain broadcast, reconcile or retry the same signed transaction.
Never create another transaction to compensate for an unknown response. A stale
or behind node cannot establish current spendability. The extension checks a
fresh authenticated response from the selected node before preparing a spend;
the node's assertions still do not constitute an independent network consensus
proof. Production node/gateway protection and public money use require the
remaining delivery gates and independent human security review.

## Light-wallet browser contracts

`build-light-wallet-probe.mjs` builds the funded correctness and 1,000-receipt
capacity probes. Stage their generated modules with `light-wallet-fixture.cjs`,
`light-server-fixture.cjs`, the corresponding `check-light-*.cjs`, vendor files,
the matching classic worker, the signature-verified official daemon and the
pinned LWS daemon. Use the disposable daemon fixture in an isolated network
namespace, no host ports, a sandboxed Chromium and tmpfs scanner state. The
correctness probe exercises real chain rollback and resubmits the same signed
bytes; it must never target a live chain or reuse a real wallet.

`check-light-stagenet.cjs` imports copies of the existing encrypted disposable
backups into new profiles. It verifies explicit scanner selection, exact legacy
balances/history, light backup recovery and scanner/native failures. The paired
profiles use `active-fixture-user.cjs` to simulate an active user while waiting;
that fixture owns and closes its activity timers. It does not change the
application's inactivity policy. Keep funded profiles, backups and addresses
ignored; do not request new faucet funding for this regression.

`measure-light-client.cjs` measures creation and funded light-backup recovery on
a desktop through explicit loopback endpoints. `rpc-traffic.cjs` records sizes,
not payloads; the runner asserts that no block/hash scan RPC occurred. It samples
RSS using `client-metrics.cjs` and removes its disposable profiles. Its encrypted
input backup must already belong to the approved disposable test. Close the
private bridges after the measurement.
