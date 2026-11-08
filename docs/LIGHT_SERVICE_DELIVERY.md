# Light service delivery decisions

Status: server-extension and manual-unlock storage routes approved on 2026-11-08;
public deployment remains unapproved. The owner subsequently selected retention
until requested deletion and no scanner database backups for this first stage. The client integration
and disposable tests are complete independently of this service decision. The
server candidate remains pinned to the revision in
[the adoption record](LIGHT_WALLET_ADOPTION.md).

## Protected persistence

The initial isolated LUKS2 test established format/open/mount/reopen/cleanup
feasibility. The subsequent approved persistent test provisioned a new private
4 GiB image, recovered a disposable scanner database after closing/reopening the
volume, deleted its registration and rejected replay against a new registration.
The volume was left closed. The owner-only recovery key and header copy are on
the owner's local machine; an offline owner-held copy still requires handoff.
The scanner database contains private view keys and cannot be placed on an
unencrypted persistent path. The project scanner must use a private encrypted
filesystem, project-specific service identity, no payload/key logging and a
scoped backup/recovery policy. The selected node has no spend authority.

The owner approved a first isolated persistent setup using a new project-only LUKS2 image,
manual operator unlocking after reboot and an offline recovery key held by the
owner. The test preflight rejects an unmounted/plaintext fallback. Any future
service startup workflow must enforce that preflight; no persistent scanner
service or boot integration is installed by these tests.
An encrypted image is not its own backup. No automatic startup, system package,
shared service, firewall or existing partition change is implied.

An unattended unlock key on the same host improves restart availability but
weakens protection against host/disk compromise. External key custody adds an
additional service, access policy, outage dependency and possibly cost. Neither
alternative is selected. Mounted data is readable to host root in all cases.
Manual unlock after reboot and owner-held recovery custody are selected. Secure
key handoff and recovery verification must precede storing non-disposable keys.

## Retention and deletion gap

The reviewed upstream database API exposes account states `active`, `inactive`
and `hidden`. The reviewed `change_status` implementation moves the account
record between states; it retains the record and associated private view key.
This is not a deletion implementation. The reviewed public wallet API does not
provide the project's authenticated deletion and retention contract. This is a
confirmed gap in the pinned candidate, not a claim that no other branch can
support it.

Do not promise deletion by hiding an account or silently adopt indefinite
retention beyond the explicit owner-selected policy below. Persistent multi-user
activation still requires the delivery gates below. Earlier temporary scanners used tmpfs and
were stopped after validation. The new encrypted volume contains only disposable
test data, with no real wallet registration or balance.

Approved route (owner decision, 2026-11-08): maintain a small server-side patch on the pinned LWS candidate
for authenticated account deletion, bounded database cleanup, key removal and
consistent scanner cancellation. Authentication must prove control of the
wallet's private view key to that chosen scanner; the spend key never leaves
the client. The implementation uses upstream Monero view-key validation and a
random registration-scoped deletion token. It removes live credentials atomically,
cleans indexes in bounded batches, resumes cleanup after restart and prevents
stale scan writes/old-token deletion of a new registration. See the
[protocol and test recipe](../experiments/lws/README.md). No new cryptographic
primitive is introduced. The selected first stage has no scanner database backups.

The 24-case native suite passed, including authenticated deletion, pending
creation rejection, concurrent scan commits, restart, shared image references,
bounded cleanup, rejection of false completion for an unknown token while cleanup
is pending, and HTTP replay. The same affected contracts passed with the
test database on the encrypted mount under an unprivileged numeric identity.
Source application checks, shell syntax and ELF non-executable stacks passed.
The browser action now checkpoints the local intent and then the server token
before deletion. On uncertain results it preserves the same token and disables
sync across reopen and encrypted v4 backup restore. Selecting the same endpoint
is blocked until its pending deletion completes; another explicitly selected
scanner does not discard accepted intents. The queue holds at most four intents,
with bounded retries and no silent eviction. The assembled Chromium fixture
passed lost-response recovery, encrypted-backup import, suppression of automatic
login, label/address preservation and explicit-consent re-registration. This is
a disposable stagenet HTTP/database fixture, not a repeat of chain spending or
mainnet capacity tests.

`complete:true` describes live database cleanup, not forensic erasure. LMDB
copy-on-write/free pages, filesystem/provider snapshots or older backups can
retain bytes. LUKS2 protects the closed volume, not data from host root while
mounted. Neither immediate physical erasure nor backup expiry is promised.

## Approved retention and backup policy

On 2026-11-08 the owner selected keeping scanning registrations and view keys
until the user explicitly requests deletion, with no automatic inactivity expiry.
Locking the client does not request server deletion. The first stage has no
scanner database backups. If that database is lost/corrupted, registrations and
the receiving index must be rebuilt by server-side scanning; the user's seed,
private spend authority and encrypted local wallet backups remain on the client.
No scheduled database copy, provider snapshot or external backup is authorized.
Owner-held LUKS2 unlock/header recovery material is not a backup of scanner data.

The owner-requested operation deletes active database records and bounded
associated indexes. It cannot revoke knowledge of a shared view key or promise
forensic erasure of copy-on-write pages, underlying storage or provider copies.
No application database backup exists to expire in this first stage. Revisit
retention/deletion disclosure before introducing any backup or snapshot system.

Unselected alternative: evaluate another compatible server with the needed deletion
contract. This requires license/maintenance review and repeats subaddress,
RingCT, signing, malformed-response, migration and operational tests. It may
avoid a maintained server patch but no compatible replacement is established.
A volatile-only scanner avoids durable key storage but loses registration and
scan progress on restart and does not meet persistent-service availability.

## Approved temporary ngrok test (2026-11-08)

The owner selected ngrok for temporary HTTPS tests instead of choosing a public
project domain. After disclosure that ordinary ngrok HTTPS terminates TLS in
ngrok's cloud and can expose addresses, private view keys and request metadata to
that provider, the owner explicitly approved this only for newly generated,
disposable, unfunded wallets. Existing/funded profiles, imported backups and
mainnet wallets must not use this test endpoint. Seed and private spend keys
remain client-only. This is a temporary exception for disposable test view keys,
not a changed production privacy policy or a promise of provider-side deletion.

Use a project-only, bounded test gateway and isolated agent configuration. Disable
local payload inspection/replay and keep inventories, endpoint capabilities,
credentials and operational evidence ignored. Do not change the owner's global
ngrok configuration, purchase/upgrade a plan, expose admin APIs or broadcast
transactions through this fixture. Close the tunnel and disposable scanner after
the test window; preserve scoped rollback and all other projects. The existing
approved private ZMQ test-node workflow may be reused with its one-writer database
rule and restoration of the prior project node. No production service activation
or mainnet release is authorized by this temporary test decision.

References: [TLS termination](https://ngrok.com/docs/gateway/domains/tls-termination),
[free-plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits), and
[agent configuration](https://ngrok.com/docs/gateway/agent/config/v3). Ordinary
HTTPS does not become end-to-end confidential merely by disabling inspection.

## Public release gate

Before persistent/public activation, review the integrated server/client source,
required checks, encrypted storage recovery, authenticated deletion, the selected no-backup policy,
capacity/admission controls and a project-scoped rollback. Choose the
public origin/TLS and obtain explicit deployment authorization. Source pushes
and isolated tests do not authorize service activation. Independent security
review and mainnet capacity remain launch gates. No mainnet release, shared
infrastructure change, paid service or deployment is approved here.
