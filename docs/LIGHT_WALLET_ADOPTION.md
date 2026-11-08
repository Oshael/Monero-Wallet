# Light-wallet adoption

## Approved direction

On 2026-11-07 the owner selected server-side light-wallet scanning on the existing
project VPS after discussion of the full browser wallet's initial and historical
scan costs. This is a scoped privacy change: the project scanner may receive the
private view key and required wallet metadata. Seeds and private spend keys stay
client-only. Transaction validation, explicit approval and signing stay local.
The server can observe incoming transactions; the model is not confidential
against the scanner operator. No third-party scanner, new fee, public deployment
or replacement cryptographic implementation is selected by this decision. The
owner later approved a separate temporary ngrok HTTPS exception exclusively for
new, disposable, unfunded test wallets, after disclosure of view-key visibility
to ngrok. See the service delivery record; production privacy is unchanged.

The existing stagenet wallet and its verified encrypted backups remain the legacy
baseline. Client integration, assembled disposable validation and the 1,000-receipt
regtest capacity case passed; no light-wallet
release or public service is adopted. Adoption must preserve
original encrypted backups, labels and pending signed/uncertain transactions.
A disconnected or behind scanner must not establish spendability or cause a
replacement transaction after an unknown broadcast. Seed-only independent
recovery remains required.

## Ownership and implementation boundaries

On 2026-11-08 the owner approved extending the pinned LWS build with
authenticated account deletion, accepting the scoped maintenance and review
responsibility. The owner also approved isolated persistent LUKS2 storage with
manual unlocking after reboot and owner-held recovery custody. These decisions
do not authorize public service deployment or establish an independently audited
release. The owner subsequently selected keeping registrations until requested
deletion, no inactivity expiry and no scanner database backup in this first stage. See
[the service delivery record](LIGHT_SERVICE_DELIVERY.md).

- The browser engine owns secret spend authority, transaction construction,
  local inspection and signing. It must validate untrusted scanner results.
- A light-wallet client transport owns bounded requests, explicit endpoint
  selection and cancellation. View-key-bearing requests never use general logs.
- The project scanner owns view-key registration, server scanning, scan progress
  and indexed receiving data. It has no spend authority or generic signing API.
- Protected storage owns server persistence and recovery. Sensitive scanning
  data must be encrypted at rest; retention/deletion are not delegated to an
  upstream default. Public activation requires an approved isolated workflow.
- The existing vault/session own encrypted client persistence, exclusivity and
  recoverable transaction checkpoints. A service change is explicit, not a
  silent credential migration from a legacy snapshot.

## Candidate review in progress

`vtnerd/monero-lws` tag `v1.0.5`, revision
`e70630140be66ac80b990df8221063ae7f28499c`, is a candidate, not an adopted
release. Its BSD-3-Clause license permits use subject to retaining the upstream
notices; the complete dependency/distribution review remains pending. Its code
contains subaddress registration and tests. The original browser wrapper does not expose the core's light-wallet mode.
Read-only source review also found that the pinned core's
`wallet2::light_wallet_key_image_is_ours` explicitly uses the original primary
address scheme and states that subaddresses are unsupported. Its output import
path does not populate a subaddress index. This is a confirmed gap in that
implementation, not a claim that the current LWS server lacks subaddresses.
Simply exposing `set_light_wallet(true)` would not preserve the existing wallet
contract.

The candidate explicitly documents in `src/db/data.h` that database encryption
is not currently used. The account record contains the private view key. Do not
put real keys into persistent candidate storage before resolving this conflict
with the approved encryption requirement. A disposable in-memory feasibility
fixture, if used, is not a durable service or a replacement storage policy.

Required evidence before adoption includes compatible subaddress receipt and
spending; correct RingCT masks, key images and decoy selection; locally reviewed
amount/fee/change; stale/malicious server rejection; uncertain-broadcast recovery;
server interruption/restart; protected-storage recovery and account deletion;
resource measurements; and absence of seed/spend keys from network/storage/logs.
Only the intentionally shared view key is exempt from the former egress rule,
and only at the selected scanner endpoint.

## Approved client integration route

The owner selected extending the current maintained engine on 2026-11-07.
The separate LWSF replacement was not selected. The comparison below is retained
as decision context.

Both routes below retain VPS-side scanning, local seed/spend authority, explicit
transaction approval, subaddresses and independent recovery. Neither permits
silently disabling a required path. No mandatory hosted subscription is needed;
build, maintenance and independent security review still have costs.

| Route                                            | What changes                                                                                                                               | Preserved requirements and unresolved evidence                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extend the current maintained engine             | Add a bounded LWS transport and complete the native light-data adapter using existing Monero routines; retain the current signer and vault | Recommended for continuity of the tested seed, vault and unsigned/signed inspection contracts. Requires extra native maintenance, subaddress/key-image verification, decoy/fee validation and adversarial tests. This is more than enabling a flag.                                                                                                                                                                |
| Evaluate a separate light client before adoption | Investigate a browser build and signing integration for `vtnerd/lwsf`                                                                      | BSD-3-Clause candidate designed for LWS, but its README labels it incomplete. Browser/MV3 support has not been established. Its file formats differ from the full wallet; its public `loadUnsignedTx` path is a TODO returning null, so the current approval/recovery contract cannot be assumed. A replacement remains an owner decision and requires fresh build, dependency, migration and spending validation. |

The reviewed LWSF revision is
`7f0d1ff11860ed8c265f6f7e0dc095c20d885fe2`. It is not installed, compiled,
adopted or substituted into the app. Reviewing another API is not proof of
end-to-end support. No project-authored cryptographic primitive is proposed.
The owner approved completing the current engine's light-data adapter using
existing Monero routines, preserving subaddresses, local signing and recovery.
This does not authorize a replacement engine or project-authored cryptography.

## Approved protected-storage feasibility test

Keep the upstream LWS database inside a project-exclusive encrypted filesystem
rather than introduce row-encryption cryptography into its LMDB records. A
LUKS2-backed private image was approved for an isolated feasibility test on
2026-11-07. Production provisioning remains separate. Initial read-only capability checks found `cryptsetup` and
`losetup` available; device-mapper control exists, while an already loaded
`dm_crypt` module was not observed. That does not prove that a mapping will work.
Those initial checks did not load a kernel module or create an image, mapping,
filesystem or mount. The approved test was subsequently executed as recorded below.

The storage feasibility test was scoped to a new 4 GiB sparse image,
a temporary recovery key, one project mapping, formatting only that
new mapping and verifying persistence/reopen and cleanup. It did not modify an
existing partition, host boot configuration, firewall, shared service or system
package. The owner explicitly authorized loading `dm_crypt` if needed and mounting or
unmounting only that test volume. No existing partitions, shared services or
boot configuration may change. Operational paths, commands,
keys and evidence stay ignored. The test is not production key custody or a
promise of automatic reboot recovery. A mounted encrypted volume remains
readable to host root; backup encryption, key recovery, deletion and crash
behavior still need review. No host-wide encryption or unrelated data migration
is proposed.

## Protected-storage feasibility result

The approved isolated test passed: a new LUKS2 image was formatted, mounted,
written, closed, reopened and read with matching content. It was then unmounted,
its mapping closed, and the temporary key and image removed. Baseline service
health and configuration fingerprints matched before and after. No wallet key
was stored during the test. This establishes the feasibility of a private
project volume on the tested host, not production key management, deletion,
backup or automatic reboot recovery.

## Client checkpoint and migration design

Newly generated wallets persist the native engine's conservative restore height
as their light-scanner birthday. This matches the existing native new-wallet
scan starting point instead of requesting a genesis scan because of an unrelated
metadata default. Seed restorations retain the explicitly requested height,
including zero. Existing backup birthdays are preserved. No current-tip guess
at connection time replaces a wallet's original birthday.

Known received outputs cannot disappear from a snapshot while the selected node
still reports their parent transaction as confirmed. Missing outputs require a
bounded node check before their old slots become inactive; ambiguous or failed
checks preserve the previous checkpoint. This protects already known receipts,
while the scanner remains responsible for completeness of previously unknown
history. Reorganizations must be validated against an actual changed node view,
not a synthetic omission with an unchanged node.

Light checkpoints without registration lifecycle state use internal snapshot
container version 3, with explicit
scanner selection, last imported height and a legacy-adoption marker. The vault
encryption, AAD, database and storage keys do not change. Versions 1 and 2 remain
readable; older clients must reject version 3 rather than mistake its cache for
a locally scanned wallet. Signed and uncertain transfer recovery stays in the
existing bounded recovery section. Deletion requests use container version 4,
which also preserves the disabled registration and bounded pending tokens. This
client reads versions 1 through 4. Older clients reject v4 rather than ignoring
an unfinished deletion and re-registering the account. This framing change does
not rename storage keys, change AES/AAD or discard transaction recovery.

Legacy adoption is explicit. The native adapter stages verified replacement
outputs while retaining subaddress labels and locally known outgoing records.
Only a successful atomic import clears the native full-scan marker. Failure
leaves the previous native state intact. The canonical adoption flag is supplied
by the local workflow, never copied from an untrusted scanner response. Unresolved
transactions retain the same signed bytes and input reservations.

Native transfer indexes remain stable across reordered responses and missing
fork outputs. Missing outputs retain an inactive slot; the adapter uses the
native spent-height maximum as an internal retirement marker, never as a real
chain height. Reappearing outputs reuse their original slot and retain explicit
freeze state. This preserves the existing native signed-set/key-image validation
without bypassing checks or changing signed transaction bytes. Container version
3 prevents an older application from treating this adapter cache as a full scan.
Both the active response and retained ledger are bounded to 10,000 outputs and
1,000,000 reconstructed output slots; exceeding a budget fails without replacing
the prior checkpoint. No accepted output record is silently deleted.

The pinned LWS counts its forward lookahead against `max_subaddresses`. Supporting
account 0 indexes 0–999 with a 1,000-position lookahead requires scanner capacity
of at least 2,000 positions. This is a server scanning budget, not an extension
of the product's 1,000-subaddress range. The client checks capacity before sending
the view key and rejects a reported lookahead failure.

The adapter uses the pinned Monero routines for ownership, key images, RingCT
commitments, transaction parsing, selection and signing. It cross-checks received
outputs and relevant confirmed transactions against the selected node, with
bounded batches and a shared deadline. These queries reveal the requested
receiving outputs/transactions to that node; use the project node with its scanner.
They never transmit the seed, spend key or locally computed key images. A remote
node/scanner remains a trust dependency for chain membership and completeness;
this does not provide independent consensus verification in the browser.

## Remaining delivery decisions

See the concrete [service delivery options](LIGHT_SERVICE_DELIVERY.md) for
protected persistence, restart recovery, deletion and retention decisions. The
server-side deletion extension and persistent storage setup are proposals, not
part of the already approved native-engine build.

Production encrypted storage/key management, retention/deletion, service
admission/capacity controls, public origin/TLS and deployment remain unselected.
The approved current-engine integration and storage test do not establish
production compatibility or authorize public activation. Investigate existing supported mechanisms first. Do not silently
accept plaintext persistence, drop subaddresses, replace the engine or create a
custom cryptographic implementation to make the integration fit.

## Sources

- [Light-wallet API](https://github.com/monero-project/meta/blob/master/api/lightwallet_rest.md)
- [Candidate server and license](https://github.com/vtnerd/monero-lws/tree/e70630140be66ac80b990df8221063ae7f28499c)
- [Light client candidate](https://github.com/vtnerd/lwsf/tree/7f0d1ff11860ed8c265f6f7e0dc095c20d885fe2)
- [Candidate storage classification](https://github.com/vtnerd/monero-lws/blob/e70630140be66ac80b990df8221063ae7f28499c/src/db/data.h)
