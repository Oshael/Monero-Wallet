# Light service delivery decisions

Status: proposed, not an approved persistent deployment. The client integration
and disposable tests are complete independently of this service decision. The
server candidate remains pinned to the revision in
[the adoption record](LIGHT_WALLET_ADOPTION.md).

## Protected persistence

The isolated LUKS2 test established format/open/mount/reopen/cleanup feasibility.
It did not provision persistent service storage or define recovery key custody.
The scanner database contains private view keys and cannot be placed on an
unencrypted persistent path. The project scanner must use a private encrypted
filesystem, project-specific service identity, no payload/key logging and a
scoped backup/recovery policy. The selected node has no spend authority.

The recommended first persistent test setup uses a new project-only LUKS2 image,
manual operator unlocking after reboot and an offline recovery key held by the
owner. The scanner refuses to start when that filesystem is not mounted.
An encrypted image is not its own backup. No automatic startup, system package,
shared service, firewall or existing partition change is implied.

An unattended unlock key on the same host improves restart availability but
weakens protection against host/disk compromise. External key custody adds an
additional service, access policy, outage dependency and possibly cost. Neither
alternative is selected. Mounted data is readable to host root in all cases.
The owner must choose recovery custody and restart behavior before provisioning.

## Retention and deletion gap

The reviewed upstream database API exposes account states `active`, `inactive`
and `hidden`. The reviewed `change_status` implementation moves the account
record between states; it retains the record and associated private view key.
This is not a deletion implementation. The reviewed public wallet API does not
provide the project's authenticated deletion and retention contract. This is a
confirmed gap in the pinned candidate, not a claim that no other branch can
support it.

Do not promise deletion by hiding an account or silently adopt indefinite
retention. No persistent multi-user service is activated until this gap and the
owner's retention policy are resolved. The temporary scanner test uses tmpfs,
contains only disposable accounts, and is destroyed after validation.

Recommended route: maintain a small server-side patch on the pinned LWS candidate
for authenticated account deletion, bounded database cleanup, key removal and
consistent scanner cancellation. Authentication must prove control of the
wallet's private view key to that chosen scanner; the spend key never leaves
the client. Design replay resistance, concurrent scan/delete behavior,
re-registration and backup expiry explicitly before implementation. No new
cryptographic primitive is proposed; verify supported upstream authentication
mechanisms before selecting an implementation.

The proposed policy retains scanning state while the account is registered,
allows owner-requested deletion and has no automatic inactivity expiry. A
finite inactivity period is an alternative that reduces retained data but forces
returning users to register and wait for another server scan. Backup retention
and the meaning/timing of deletion must be selected with the owner; removing a
live LMDB row alone cannot erase an older backup or revoke a previously shared
view key. Neither proposed retention policy is approved by this document.

Alternative route: evaluate another compatible server with the needed deletion
contract. This requires license/maintenance review and repeats subaddress,
RingCT, signing, malformed-response, migration and operational tests. It may
avoid a maintained server patch but no compatible replacement is established.
A volatile-only scanner avoids durable key storage but loses registration and
scan progress on restart and does not meet persistent-service availability.

## Activation gate

Before persistent/public activation, review the integrated server/client source,
required checks, encrypted storage recovery, authenticated deletion, backup
expiry, capacity/admission controls and a project-scoped rollback. Choose the
public origin/TLS and obtain explicit deployment authorization. Source pushes
and isolated tests do not authorize service activation. Independent security
review and mainnet capacity remain launch gates. No mainnet release, shared
infrastructure change, paid service or deployment is approved here.
