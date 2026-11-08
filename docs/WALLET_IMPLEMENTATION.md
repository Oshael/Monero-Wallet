# Wallet implementation and verification

## Approved server work (2026-11-08)

The LWS database owns authenticated deletion, account-scoped indexes and atomic
writer transactions. The wallet HTTP endpoint validates the request and invokes
that operation; it does not manipulate tables. Scanner workers must stop using
deleted registrations and cannot repopulate them from an older scan. Protected
storage owns the encrypted filesystem and manual mount lifecycle independently
of scanning. Neither responsibility belongs in the browser runtime or vault.
The approved scope is the pinned server extension and isolated LUKS2 persistence,
with no public activation. The subsequent owner decision keeps registrations
until requested deletion, has no inactivity expiry and creates no scanner
database backups in this first stage.

The maintained patch, build recipe and contracts are in
[`experiments/lws`](../experiments/lws/README.md). The final native suite passed
all 24 cases in the isolated Linux build. A disposable stagenet registration and
deletion authorization survived an actual LUKS2 close/reopen; recovery, deletion,
re-registration and replay rejection passed under an unprivileged identity.
The affected HTTP/database contracts also passed on the encrypted filesystem.
The volume was closed afterward and its temporary server-side unlock key removed.
The server work changed no client encryption format, seed/spend authority or
existing funded backup. The subsequent client snapshot framing is described below.

The server structural review kept account deletion and every index mutation in
the database writer transaction. Shared image references are maintained by the
existing spend insertion/rollback owner. HTTP owns decoding and composing the
database operation with mempool-cache invalidation. Scanner polling invokes
bounded cleanup without owning tables or deletion state. No application-wide
state bag, dependency cycle or browser/server import was added. Existing database
CRUD remains in upstream storage; this change adds one cohesive account lifecycle
operation there rather than moving table ownership to a transport handler.
The first-use fork schema rejects non-empty upstream private tables; no existing
database was migrated. The client deletion workflow and its assembled browser validation passed; the
public startup workflow remains outstanding work. No expiry timer or database backup job is selected.

## Client deletion ownership

The client deletion integration gives a dedicated registration owner the selected
scanner, local registration phase and bounded pending deletion intents. Light
sync retains only validated height/adoption state and reads the registration
owner's permission to register. A separate session workflow checkpoints the
request and then the server token before deleting; transport failures preserve
the same intent/token for retry. Explicit endpoint changes retain older pending
intents. Snapshot container v4 protects this new state from older clients that
would otherwise ignore it and register again. Vault encryption/AAD, storage keys,
wallet keys, cached history and the transfer journal remain unchanged. The UI
owns deletion consent, per-origin permission requests and status display in its
own panel; the connection form retains only endpoint selection/consent.

The application checks passed typed lint, strict types, dependency boundaries,
formatting and 69 tests. The Chromium fixture using the real pinned REST/database
modules passed an intentionally lost deletion response, encrypted v4 backup
import, no automatic login/re-registration, retained address/labels and fresh
consent for re-registration. The prior real-chain receipt/send evidence remains
unchanged; this new fixture isolates the deletion lifecycle and uses no funds.
The native suite passed 24 cases after adding authenticated absence preparation
without registration and recovery of unfinished cleanup tokens. The privileged
storage remount test was not rerun for that API-only extension; its earlier
passing filesystem/key-recovery result remains valid.

The final client structural review found one authoritative registration owner:
endpoint, phase, current operation and accepted pending intents. Sync owns only
its validated height/adoption and request lifecycle. The session workflow owns
checkpoint-before-network ordering; session integration only composes it under
the existing exclusivity/idle rules. Snapshot decoding validates the bounded
registration representation and v4 framing; it does not perform network IO. No
private key/token is published through the view, and the deletion transport
never registers or uses a generic logger. Each request client disposes its
credentials/abort lifecycle and has a 20-second total budget. Existing module
boundary checks cover all new imports. No dependency, cycle, vault access from
the engine or shared mutable application context was introduced.

## Continuing execution authority

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
The historical tests and measurements below describe the prior full-scanning
prototype. The separate light-client results are recorded here and in the
adoption record. The historical desktop
scan stopped at its 15-minute fixture deadline after reaching height 700,301
without the former worker timeout. Its unfinished encrypted test profile was
preserved and its local bridge stopped; the full historical benchmark is not
reported as complete or required as the new default browser workflow.

## Light-client validation

The maintained adapter uses the existing Monero cryptographic routines and
keeps the legacy light-wallet flag disabled. Native coin selection, decoy
selection, unsigned/signed inspection and relay remain the existing paths.
Light preparation opens a native view-only cache and restores its verified
height without downloading blocks for a local chain scan.

The pre-endpoint-path native source compiled cleanly in a second checkout and reproduced
the incremental artifact byte for byte:

| Artifact                | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Native glue             | `eb32adc09ec0c6c1c9596109b2d208a9a7425c781bd1371e1d9d41cfb75293ed` |
| Embedded WASM           | `1909474c417a8b4e93e1f399e107dcb218dade28fab300e92ec532dd689e38ef` |
| Matching classic worker | `d39fea4e8a33fa23972c3ecbf4c8fb64f122a93b0d6ad75e6c691665bfb1b9aa` |

The worker is 8,159,017 bytes. The ESM source-map inventory retained the same
62 dependency roots with no additions or removals. The generated client and
native notices accompany the development build. This is not an independent
security audit or an approved public release.

The subsequent temporary HTTPS test exposed a native endpoint-path routing bug,
described in the [native recipe](../experiments/wallet-mv3/README.md#native-rpc-endpoint-paths).
The corrected build preserves each selected RPC path for JSON/binary calls and
clears it on host/port reselection. Two wallet connections remain independent.
Both complete patches apply to their pinned pristine source files; the incremental
and independent clean native builds match byte for byte:

| Artifact                | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Native glue             | `ded0635b9f48f845ebabbff60ec3446e4f271d856d7f8488995d04f0fd49edc5` |
| Embedded WASM           | `5423c711d27c19cff111a3ad0cd6cb5e766ca71001f9134e97c3ca530d018632` |
| Matching classic worker | `b3b62d6f81ad8a954c3600c6b7dca6a1ebb11d47d159005d27ff9b098463c5e4` |

The matching worker is 8,159,951 bytes. Typed lint, strict types, boundaries,
formatting, all 69 application/quality tests and the development extension build
passed with this candidate. Native RPC path/reselection, Digest authentication,
binary/size/redirect/timeout regressions passed. The native light-wallet regtest
passed again with this engine, including ownership/commitment rejection,
keys-only outgoing recovery, exact fee/change and detached-confirmation input
reservation. The path prefix belongs to the
native connection instance; no global mutable routing state, UI rule, dependency,
crypto change, new secret accessor or persistence format was added. This fixes an
existing transport responsibility. The subsequent funded stagenet ngrok run passed
explicit selection, labelled subaddress receipt, local approval/signing,
prepared/signed checkpoint reopening, loss of an accepted broadcast response and
retry of the same signed bytes, a return payment, exact fee/change accounting,
real confirmation/unlocking, independent funded-backup import and authenticated
deletion. After a read-only synchronization action collided with background work,
the test resumed its durable sender journal instead of creating another payment.
The browser helper now waits with bounded retries only for rejected busy sync
requests. It does not retry signing or create replacement transfers.

Scanner registrations were absent after deletion, the temporary tunnel and test
processes stopped, the approved VPS tmpfs credential was removed, the prior node
was restored and preservation/backup checks passed. The encrypted storage volume
remained closed. Known development fixtures now have separately declared recent
starting heights; fresh-scanner recovery covered roughly 1,400–1,800 blocks in
about 35 seconds per wallet while preserving the exact total balance. The
original backups and production birthday rules are unchanged. See the
[test iteration policy](WALLET_DEVELOPMENT.md#light-wallet-browser-contracts).

The real offline-regtest LWS contract passed primary and subaddress receipt,
including index 999; exact unlocked balance, fee and change; local unsigned
preparation and signing; confirmation and native cache recovery; same signed
bytes after reordered output data; keys-only recovery of a confirmed send;
stale-data input reservation and real detached-confirmation recovery; atomic rejection
of malformed ownership/commitment/global-index data and omitted known receipts;
legacy pool-receipt reconciliation without double credit; and secret egress canaries.
The seed and spend key stayed absent from requests. The intentionally shared
view key appeared only in selected scanner request bodies. The LWS fixture
stored its state in tmpfs and exposed no public service.

The assembled offline extension contract passed encrypted storage, seed
verification/hiding, subaddress labels, independent backup import, password
rotation, exclusive ownership, abrupt closure recovery, prepared-transfer
review/cancellation and worker/native fatal locking. Typed lint, strict types,
module boundaries, all 58 application/quality tests and the development build
passed. Assembled live-stagenet validation subsequently imported the original encrypted
backups into new disposable profiles, explicitly selected the scanner, preserved
both exact balances and the confirmed send, and reopened encrypted light
checkpoints. Scanner failure preserved balances; an injected native import fatal
terminated both workers without advancing the vault revision. The original
funded profiles and backups were preserved. The final native artifact also
passed the existing full-wallet regtest signing/relay regression.

The first paired-profile stagenet attempts timed out because the other profile
was idle while one workflow ran. Checkpoint inspection showed successful light
imports. The corrected runner owns bounded trusted user activity for both
profiles and closes those timers before closing the browsers. Only the corrected
assembled run is reported as passing.

On an ordinary 8 GiB Mac, Chromium 156.0.8078.4 measured the final light client
through temporary loopback SSH bridges to the project scanner/node. No VM or
local daemon ran. Each scenario used a new disposable profile and ended by
reopening its encrypted checkpoint; no local block/hash scan RPC was observed.

| Scenario                    | Total elapsed | Sync step | Sampled peak browser RSS | RPC response bytes | Encrypted backup bytes |
| --------------------------- | ------------- | --------- | ------------------------ | ------------------ | ---------------------- |
| Newly created light wallet  | 46,690 ms     | 40,205 ms | 1,198,944 KiB            | 14,546             | 412,390                |
| Restore funded light backup | 21,826 ms     | 10,106 ms | 1,532,528 KiB            | 29,442             | 54,688,176             |

RSS sums browser processes and can count shared memory more than once; samples
were taken once per second. SSH setup per connection and 30-second polling can
dominate these timings. The funded backup retains its legacy cache and was not
silently compacted. These small disposable stagenet histories are not a
many-output or mainnet capacity claim. The scanner was already indexed for the
funded account. The temporary bridges were stopped after measurement.

The additional capacity fixture passed with 1,000 received RingCT outputs across
account 0 indexes 0–999 and a send requiring many inputs. It preserved the exact
unlocked balance, locally inspected/signed the transaction, observed no block/hash
scan RPC during preparation and passed private canaries. Native keys/cache
serialization totaled 1,922,472 bytes. On the isolated test host, import took
2,051 ms, preparation 3,070 ms and signing 1,366 ms; these fit the existing
20-second import and 30-second command budgets in that environment. This is
one offline-regtest dataset, not a representative mainnet/server-capacity claim.

The first dataset used 0.001-unit receipts and a 0.05-unit send and was rejected
with native `tx not possible`. The isolated early chain reported a base fee of
1,200,000 atoms per byte. The corrected fixture uses 0.1-unit receipts and a
5-unit send, still requiring at least 50 inputs before fees, without changing
native fees, dust policy, selection, validation or application limits. A reduced
64-receipt comparison passed with a 41,352,000,000-atom fee; the 1,000-receipt
run passed with a 41,524,800,000-atom fee. The original reduced dataset's total
0.064 units could not fund its 0.05-unit send plus that many-input fee. The
initial failed fixture is retained as diagnostic history, not reported as a
successful spending test. No real funds were used and failed preparation did
not sign or relay a transaction.

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
  `WalletConnection` owns endpoint selection and the current synchronization
  lifetime. `NodeConnectionOwner` publishes a selection only after native
  configuration succeeds. The light client owns view-key-bearing transport,
  registration and bounded response validation; `LightWalletSync` owns request
  cancellation, progress and the matching native-cache checkpoint height.
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
the migration. Full-scan checkpoints write version 2; explicitly selected light
checkpoints without registration state use version 3 to prevent older clients
from misreading their native cache. Tracked deletion lifecycle state uses version
4 so older clients cannot ignore it. All use the same bounded recovery section
and atomic vault. AES envelope
version/AAD, IndexedDB names/schema and passwords
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

## Light integration structural review

The runtime remains a workflow coordinator. Endpoint selection and native node
configuration moved into `WalletConnection` and `NodeConnectionOwner`, while
`NativeWalletState` remains the sole owner of cached balances/freshness.
`LightWalletSync` owns its scan promise, cancellation timer, retained fatal and
checkpoint height. `LightWalletClient` owns short-lived view-key credentials,
registration and transport; disposing it aborts pending requests. The snapshot
module owns only framing/metadata and delegates transfer recovery to the
transaction domain. The signer owns the temporary view-only observer and closes
it after either full or light preparation. UI forms own consent and host
permission requests and use only session operations.

The native adapter owns staged output verification and atomic wallet-state
replacement. It uses existing Monero primitives/parsers and bounded node RPC;
all parse, ownership, chain-output and allocation checks precede state swaps.
Stable transfer indexes preserve signed-set/key-image validation across reorders
and forks. Old labels, explicit freeze state and unresolved local sends remain
recoverable. Scanner-supplied totals never replace computed native balances.
The final review found no new dependency cycles, persistence access from the
engine, UI access to engine internals, shared application context or new npm
dependencies. Operational inventories and evidence remain ignored.

The preexisting session coordinator still composes vault/session/idle/send
lifecycles. This change adds only its light-connection checkpoint operation and
waiting-scanner polling behavior. Further session lifecycle extraction, if
needed, should separate startup ownership first and polling ownership second,
while preserving exclusive locks, abort/fatal handling and durable sends; the
existing session, send-workflow and assembled lifecycle contracts are the
required regression surface. That unrelated extraction is not necessary to
establish the new scanner ownership boundary.
