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

The owner subsequently approved temporary use of Nodely's HTTPS stagenet node
for disposable-wallet receipt and sending tests, after disclosure of IP and
request-metadata exposure. This approval does not select a product default or
permit sending wallet secrets. The own test node completed synchronization before
that fallback was needed; live validation used the own node; the public fallback was not used.

## Selected architecture update

The owner subsequently selected VPS-side light-wallet scanning; see
[the adoption decision](LIGHT_WALLET_ADOPTION.md). Private view keys may reach
only the chosen project scanner. Seeds, spend keys and signing remain local.
The tests and measurements below describe the prior full-scanning prototype;
they do not establish light-client or LWS compatibility. The historical desktop
scan stopped at its 15-minute fixture deadline after reaching height 700,301
without the former worker timeout. Its unfinished encrypted test profile was
preserved and its local bridge stopped; the full historical benchmark is not
reported as complete or required as the new default browser workflow.

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

Live receipt exposed a separate observer-initialization defect before any
signature or broadcast. Native compact `export_outputs` intentionally omits
RingCT masks; importing it into a new view-only wallet sets an identity mask.
The native real-output check correctly rejected transaction construction. A
regtest that spends a normally received output reproduced the same failure;
the earlier coinbase-funded spending case did not cover it.

The maintained TypeScript wrapper now exposes an optional
`getData({ viewOnly: true })`, using the existing native view-only key serializer
with the complete cache. Default exports remain unchanged. `TransactionSigner`
owns that temporary observer, checks `isViewOnly()`, clears exported buffers and
closes the observer after preparation. Its native opening password is passed
from the engine's existing in-worker metadata through `WalletTransfers`.
No vault format, native serialization format or cryptographic primitive changed.
The corrected regtest passed receiving and spending the RingCT output, exact
change, preserved observer state and rejection of spend-key retrieval. The
original full wallet retained spend authority. This wrapper correction did not
change the native WASM; the later scheduling correction below does.

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
- The unpublished own stagenet test daemon completed synchronization at observed
  height 2,245,716. The assembled extension synchronized the existing disposable
  wallet in 10,016 ms, received the faucet's exact 0.5 sXMR as unlocked balance,
  exported a funded encrypted checkpoint and reopened with the same balances.
  The assembled UI then prepared 0.1 sXMR, recovered its prepared and signed
  checkpoints, and broadcast the approved transaction. A test route forwarded
  the real broadcast, then dropped its accepted response. Reopening preserved the
  same unknown transaction; cancellation was rejected and retry sent identical
  signed bytes. Separate settlement validation confirmed exactly 0.1 sXMR
  received/unlocked, a 0.00003046 sXMR fee and 0.39996954 sXMR unlocked change.
  Both confirmed encrypted checkpoints reopened with the same balances/hash.
  This evidence spans explicit diagnosed phases: the broadcast runner's final
  unlock assertion ran one poll before the sender's change unlocked; the
  settlement runner waited for both wallets and passed. It is not reported as
  one uninterrupted passing run.
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
reconstructed review and cancellation after editing. The assembled funded
stagenet phases above also exercise the actual UI, vault, own node and uncertain
broadcast recovery. No second transaction is constructed to compensate for an
unknown response.

## Client measurements and interrupted scanning

Measurements below used one physical 8 GiB RAM desktop, Chromium 156, no VM,
an empty disposable stagenet wallet and the synchronized own node. HTTP traffic
includes request/response headers and bodies. Memory is summed browser-process
RSS sampled every second; shared pages can be counted more than once.

| Workflow                                              | Elapsed   | Peak browser RSS | Response traffic                | Encrypted backup |
| ----------------------------------------------------- | --------- | ---------------- | ------------------------------- | ---------------- |
| Create, verify seed, connect, scan, export and reopen | 74,724 ms | 1,133,936 KiB    | 66,262,272 bytes / 390 requests | 54,676,280 bytes |
| Restore from height 2,235,659 to 2,245,740            | 79,447 ms | 1,168,224 KiB    | 60,740,011 bytes / 372 requests | 54,675,978 bytes |

The recent restore scanned 10,081 heights. It is a seed restore using a recent
height, not a measured cache that literally spent weeks offline. These are
initial datasets, not mainnet, many-output capacity or whole-system memory peaks.
The recent and new-wallet runs precede the native scheduling correction below.

Restoration from height zero exposed a worker response timeout near height
366,000. Peak sampled RSS was about 1.06 GiB; the observed failure was a 30-second
`view` command deadline, not established memory exhaustion. Native refresh
preprocesses transaction batches before publishing progress. Yielding only in
progress callbacks did not fix the reproduced timeout and was removed. The
maintained core patch now yields to the browser between native pool jobs after
their bookkeeping is restored and while the queue mutex is unlocked. It is
Emscripten-only, checks a 50 ms elapsed budget and uses existing Asyncify support.
It does not guarantee a 50 ms worst-case job, change cryptographic calculations,
skip outputs or increase request/worker deadlines. Historical restoration and
all affected engine contracts must pass with this artifact before closing this
validation item. The clean and incremental builds produced identical glue
`7e430a4bfe8f1523d522b43e3d7af5ee2225cac26991a628127eae811a07d180`;
the matching worker embeds WASM
`2948fb4751b53f592adb2bbf908a1c0ea942a7802ab0eaad4778e6fccb2db94f`.
RPC, CLI/entropy, bidirectional cache compatibility, view-only authority,
received-output spending, UI recovery and lifecycle contracts passed with this
artifact. Read-only live settlement also reopened both confirmed wallets with
exact balances and the original transaction hash. Historical restoration remains
under measurement and is not included in that completed-contract claim.

Interrupted-page and node-failure recovery passed on the own node. A stopped scan
checkpoint reopened at the same height. Simulated inactivity and elapsed-resume
visibility events terminated both workers; actual OS suspend remains a manual
release check. A new regression reproduced a background native fatal exception
being treated as an ordinary scan failure. `WalletSync` now retains that fatal
result and `EngineRuntime` checks health before granting access to active state.
The corrected test locked both workers and preserved the existing vault revision
instead of checkpointing the failed native state; reopening remained possible.

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
The temporary transaction observer owns its view-only keys/cache and closure;
the signer clears exported buffers in `finally`. The opening password remains
inside the engine worker and follows its lifetime. `WalletSync` owns its retained
background fatal result; the runtime checks it before exposing active state.
The native pool owns its cooperation clock, restores task bookkeeping before
yielding and changes no non-Emscripten behavior. The discarded progress-listener
and JavaScript-yield hypotheses are absent from the final implementation.

The identical native builds used the same isolated build image and pinned SDK;
this is not yet a cross-platform or independently audited release pipeline.
