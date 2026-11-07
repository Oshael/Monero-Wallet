# Wallet implementation and verification

The owner authorized completing the wallet work on 2026-11-07, continuing without
milestone approval requests and stopping for material owner decisions. The owner
also explicitly authorized continuation after context compaction once the task,
repository and diff have been reconstructed. This authorization does not change
the project's shared-host preservation, custody or public-release requirements.
The owner subsequently removed the agent-imposed VPS resource ceilings for this
work. The stagenet test node may use available host resources and run until its
tests finish. It remains project-owned, unpublished and separate from other
projects' code; this does not authorize changing those projects or shared host
configuration. Client-side safety budgets and representative-device measurement
requirements remain in force.

On 2026-11-07, the owner approved the extension's `unlimitedStorage` permission
after Chromium returned `false` from `navigator.storage.persist()`. This protects
extension storage from automatic eviction and relaxes browser quotas; it does not
remove application payload limits, disk exhaustion handling or the need for
independent seed and encrypted backups. It adds no remote storage or fee.

## Module ownership

- `src/vault`: authenticated envelope, password derivation, crypto-worker lifetime
  and atomic encrypted IndexedDB records. No engine, UI or transaction dependency.
- `src/engine`: the candidate engine and its unlocked keys, native state and
  transaction construction/signing in a worker. No browser persistence or UI.
  `NativeWalletState` alone owns cached heights, balances and freshness. Scan
  listeners and transfer completion use its operations, not a shared mutable
  application-view object. The runtime composes its read-only projection with
  metadata and the transaction journal. Broadcast refreshes native local balances
  and marks them stale until another scan; reconciliation preserves a completed
  scan's freshness to avoid an immediate scan/reconciliation loop.
- `src/session`: session lifecycle, exclusive wallet ownership, lock/unlock and
  composition of engine checkpoints with the vault.
- `src/transactions`: immutable user intents, local transaction inspection,
  approval, broadcast reconciliation and duplicate-spend prevention.
- `src/ui`: transient form data and views using the session's public operations.
- `src/domain`: pure value validation and monetary arithmetic.

## Cryptographic candidate

The first envelope uses Web Crypto AES-256-GCM with a fresh 96-bit nonce per seal,
a 128-bit tag and the entire fixed header as authenticated additional data.
Password derivation uses maintained `@noble/hashes@2.4.0` scrypt with `N=2^17`,
`r=8`, `p=1`, 32 output bytes and a fresh 128-bit salt for creation or password
rotation. KDF allocation is bounded at 160 MiB. Derived keys are imported as
non-extractable CryptoKeys; mutable password/key byte buffers are cleared.
JavaScript strings, garbage collection and a compromised unlocked runtime remain
limitations. The crypto worker will be terminated on lock.

Argon2id was evaluated as a candidate. Noble's documentation excludes Argon2 from
its independent audit and recommends scrypt for its JavaScript implementation's
performance. Selecting scrypt follows that guidance and the plan's memory-hard
KDF requirement. The dependency's 2022 audit does not audit this integration or
every change in the selected release. Independent review remains required before
public money use. [Library security and performance notes](https://github.com/paulmillr/noble-hashes/tree/2.4.0#security)
and [scrypt specification](https://www.rfc-editor.org/rfc/rfc7914.html).

The binary header is 52 bytes: `XMRVAULT` magic, version 1, header length, scrypt
log2-N/r/p, salt and nonce. Integers use big-endian encoding. The payload is opaque
and encrypted, including network/node settings and all sensitive engine/cache
state. Unsupported KDF parameters, versions, malformed/truncated and oversized
inputs are rejected before derivation. The provisional per-envelope plaintext
limit is 128 MiB; this is an implementation safety bound, not a claim about wallet
capacity. Representative serialized-state measurements must validate it before
supported capacity is declared. The approved `unlimitedStorage` permission is
declared in the extension manifest to protect the IndexedDB vault from eviction.

## Verification status

The original snapshot metadata budget was 16 KiB but included pending transaction
hex strings whose individual domain budget was 32 MiB. A regression with a
200,000-character unsigned/signed record failed before correction. Snapshot
container version 2 keeps settings under 16 KiB and gives the transaction domain
its own bounded recovery section, preserving the existing hex limits and total
128 MiB payload cap. The transaction module owns recovery encoding/validation;
the engine snapshot module owns framing and offsets. Version-1 snapshots remain
readable, including a golden fixture produced by the original encoder before
the migration. Subsequent checkpoints write version 2 atomically through the
existing vault. AES envelope version/AAD, IndexedDB names/schema and passwords
are unchanged; independently exported version-1 backups remain readable.

Prepared recovery now exposes only its review tuple (destination, amount, fee,
expiry and status), never transaction blobs, to the UI. The send feature owns its
review/status rendering. The session refreshes its public view after a durable
prepare so the user can cancel an edited preparation; reopening a prepared
checkpoint reconstructs its review before approval. Signed/uncertain recovery
continues to display the original destination and amounts for reconciliation.

The native cold-signing probe signed successfully. Its post-sign inspection
exposed an API mismatch: upstream `describeTxSet` accepts unsigned and multisig
sets, not signed sets. The maintained-build patch extends that existing native
descriptor using `wallet2::parse_tx_from_str` and the resulting pending
transaction construction data, as already used by the native submit operation.
It reuses the existing native destination, fee, change and unlock-time
description; it does not replace transaction signing or cryptographic algorithms.
The funded disposable-chain test passed preparation, both inspections, signing,
broadcast and exact receipt. It also rejected an altered signed intent, confirmed
the approved fee, exercised an integrated address and recovered the receipt after
detaching and replacing a block. Direct node-status requests bypass the native
RPC proxy's cached height. Spending requires the wallet to match the known tip;
cached transaction status is identified as stale until synchronization completes.

- Public API create/export/close/reopen passed with the independently built
  candidate. Address, account/subaddress labels and wrong-password rejection were
  checked after terminating the original worker. The disposable wallet's keys
  were 1,715 bytes and its cache was 418,552 bytes.
- The Emscripten 6.0.13/Node 24.19.0 build passed the browser contracts.
  Its serialization compatibility correction uses `std::make_unsigned`, as the
  official Monero source does. A final public API probe reopened caches in both
  directions with the earlier artifact and preserved accounts, subaddresses and
  labels. Ten malformed signed sets were rejected without crashing the engine.
- JSON/binary RPC, Digest authentication and wrong-password rejection, HTTP 503,
  response-size limits, redirect rejection and a request deadline passed with
  the current WASM. The oversized-response fixture rejects before its deadline,
  rather than passing due to a deliberately broken Content-Length response.
- Test-only browser capture found no seed, private view/spend keys or wallet
  password canaries in the observed request URLs, headers and bodies. It checks
  text, URL-encoded and raw key bytes. It does not prove absence of arbitrary
  malicious encodings or future regressions.
- UI creation, encrypted storage, seed verification, password rotation,
  subaddresses, exclusive tabs, explicit locking, abrupt tab closure and backup
  import after temporary local-data deletion passed. The recovered address and
  receiving labels matched. Failure of a worker or password-key commit now locks
  the complete session; its browser regression passed. An injected native
  WebAssembly failure also locked the complete session. Seed display hides on
  visibility changes to avoid relying on a throttled background timer.
- On a physical 8 GiB RAM Mac, Chromium 156.0.8078.4 completed the offline UI flow
  in 17,784 ms. Across 18 one-second samples, summed browser-process RSS peaked at
  1,185,936 KiB and the test runner at 65,568,768 bytes. Summed RSS can double-count
  shared pages. This is one initial local workflow measurement, not an old-wallet
  chain scan, mainnet benchmark or whole-system memory peak. No VM was started.
- [Native notices and provenance](NATIVE_DEPENDENCIES.md) identify the compiled
  libsodium source files against official 1.0.18 and collect 19 native notices.
  The inherited stubs remain aborting. A fresh native build from clean pinned
  trees reproduced the final artifact byte for byte; independent review remains open.
- An unpublished stagenet test daemon is syncing under the owner's authorization
  to use available VPS resources until its tests finish.
  Funded stagenet flows and representative client measurements remain pending.
- The attempted historical-scan measurement against the still-syncing own node
  did not perform a scan. The native `monero_wallet_full::sync` checks
  `is_daemon_synced()` before calling `sync_aux`; observed wallet height remained
  1 with `waiting-node`. The first attempt reached its fixture deadline and a
  diagnostic repeat confirmed that prerequisite. Neither is reported as a
  performance result. The benchmark now rejects a not-ready node immediately.
  The engine performs its fresh readiness check before invoking a native scan.
  `waiting-node` therefore means that cycle has no new native cache to save; the
  session skips an unchanged encrypted checkpoint instead of rewriting it every
  30 seconds. A completed or interrupted scan still checkpoints before resuming.
  The browser contract confirmed no vault revision change while waiting. It also
  imported the original encrypted v1 backup of the same disposable stagenet
  wallet, wrote a current checkpoint and reopened the same address. One earlier
  profile run failed without phase diagnostics; the diagnostic and explicit-import
  runs passed. Watch that timing uncertainty during live-node validation.

The funded regtest runner exercises the native signer and transaction recovery
codec directly. The UI recovery fixture uses deliberately invalid unsigned bytes
that are never signed or relayed; it verifies large encrypted recovery,
reconstructed review and cancellation after editing. Full assembled funded
stagenet sending and representative client scan measurements are still pending.

## Quality gates

Application TypeScript is strict and ESLint uses type information. Authored
functions are limited to cyclomatic complexity 10, nesting depth 3 and four
parameters. CJS/JS experiment runners use a JavaScript fixture profile with the
same complexity limits. No file-length gate is enabled. Dependency-cruiser checks
cycles, browser/server boundaries and module ownership restrictions. Prettier is
the only formatter. `npm run verify` combines lint, types, dependency boundaries,
formatting and contract tests. The last integrated run passed lint, types,
boundaries, formatting and 38 tests. The same build passed the browser contracts
for fatal-worker locking, large prepared-send recovery, original encrypted v1
backup migration and seed hiding on a visibility event. A newly created offline
stagenet wallet reported restore height 2,226,704, below the observed network tip
of 2,245,495; the suspected future-birthday condition was not reproduced.
Headless Chromium reports both tabs as visible; actual physical-tab visibility
remains a manual browser release check. CI uses pinned official actions and
repeats `verify` on main pushes and pull requests. Check the commit's workflow
result before integration; a local pass does not establish CI success.

## Structural review

The vault owns encryption and atomic records; the engine owns native unlocked
state; the transaction journal alone owns pending-send transitions. The session
composes those public contracts and owns lock, exclusivity and checkpoint timing.
Sending never proceeds past its durable pre-broadcast checkpoint on a storage
failure. UI connection, receiving and seed-display lifecycles remain in their
own modules. Private module import restrictions are covered by gate tests.

Test measurements own and dispose browser contexts, temporary profiles, CDP
sessions and sampling timers. Infrastructure bridges and inventories remain in
ignored operational files. Clean artifact generation removes stale test files;
native/client notices and the noble-hashes license accompany the generated build.
The identical native builds used the same isolated build image and pinned SDK;
this is not yet a cross-platform or independently audited release pipeline.
