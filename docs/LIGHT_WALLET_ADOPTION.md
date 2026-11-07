# Light-wallet adoption

## Approved direction

On 2026-11-07 the owner selected server-side light-wallet scanning on the existing
project VPS after discussion of the full browser wallet's initial and historical
scan costs. This is a scoped privacy change: the project scanner may receive the
private view key and required wallet metadata. Seeds and private spend keys stay
client-only. Transaction validation, explicit approval and signing stay local.
The server can observe incoming transactions; the model is not confidential
against the scanner operator. No third-party scanner, new fee, public deployment
or replacement cryptographic implementation is selected by this decision.

The existing stagenet wallet and its verified encrypted backups remain the legacy
baseline. The light model is not yet integrated. Its adoption must preserve
original encrypted backups, labels and pending signed/uncertain transactions.
A disconnected or behind scanner must not establish spendability or cause a
replacement transaction after an unknown broadcast. Seed-only independent
recovery remains required.

## Ownership and implementation boundaries

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
contains subaddress registration and tests. The current browser wrapper does not expose the core's light-wallet mode.
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

## Client integration decision prepared for owner review

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
The affected client implementation is paused pending the owner's route choice.

## Protected storage proposal

Keep the upstream LWS database inside a project-exclusive encrypted filesystem
rather than introduce row-encryption cryptography into its LMDB records. A
LUKS2-backed private image is a candidate storage mechanism, not an approved
provisioning operation. Read-only capability checks found `cryptsetup` and
`losetup` available; device-mapper control exists, while an already loaded
`dm_crypt` module was not observed. That does not prove that a mapping will work.
No kernel module was loaded and no image, mapping, filesystem or mount was made.

A proposed storage feasibility test would create only a new 4 GiB sparse image,
use a temporary recovery key, open/close one project mapping, format only that
new mapping and verify persistence/reopen and cleanup. It would not modify an
existing partition, host boot configuration, firewall, shared service or system
package. Loading `dm_crypt` or mounting a filesystem is host-level work and needs
explicit approval for that scope before execution. Operational paths, commands,
keys and evidence stay ignored. The test is not production key custody or a
promise of automatic reboot recovery. A mounted encrypted volume remains
readable to host root; backup encryption, key recovery, deletion and crash
behavior still need review. No host-wide encryption or unrelated data migration
is proposed.

## Open delivery details

Encrypted server storage, retention/deletion, a maintained client integration,
service admission/capacity controls, public origin/TLS and deployment remain
unselected. Investigate existing supported mechanisms first. Do not silently
accept plaintext persistence, drop subaddresses, replace the engine or create a
custom cryptographic implementation to make the integration fit.

## Sources

- [Light-wallet API](https://github.com/monero-project/meta/blob/master/api/lightwallet_rest.md)
- [Candidate server and license](https://github.com/vtnerd/monero-lws/tree/e70630140be66ac80b990df8221063ae7f28499c)
- [Light client candidate](https://github.com/vtnerd/lwsf/tree/7f0d1ff11860ed8c265f6f7e0dc095c20d885fe2)
- [Candidate storage classification](https://github.com/vtnerd/monero-lws/blob/e70630140be66ac80b990df8221063ae7f28499c/src/db/data.h)
