# Isolated LWS deletion extension

This is build/test source for the owner-approved server extension. It installs
no host service and opens no public port. The owner selected retention until
requested deletion, no inactivity expiry and no scanner database backup in the
first stage.
It is not a public release or an independently reviewed security boundary.

## Source and dependencies

Pin `vtnerd/monero-lws` to `e70630140be66ac80b990df8221063ae7f28499c`
(`v1.0.5`). Its Monero gitlink is
`85f036ba7019cd36f08e8a38a27c37ea7b522618`. Initialize recursive submodules
without replacing their commits. Retain the upstream BSD-3-Clause notices.
The extension uses existing Monero key validation and its cryptographic random
source. It adds no JavaScript dependency or cryptographic primitive.

Build the existing native image from the wallet experiment, then the derived
`Dockerfile.build` (two additional Boost libraries, container only). Prepare a
clean pinned checkout with `prepare-source.sh CHECKOUT`. Run
`build-and-test.sh CHECKOUT` inside that image with the checkout mounted, no host
network, no published ports and no Docker socket. The HTTP unit tests use
container loopback. Linux executable linking explicitly disables executable
stacks (an inherited assembly object lacks its stack note), and the recipe checks
all resulting ELF headers. The image and scripts are test infrastructure, not an
approved public deployment workflow. Record resolved image IDs and package
versions in ignored operational evidence.

The `LWS quality` workflow repeats the pinned source preparation, native suite
and ELF checks on an ephemeral Linux runner for changes to this extension. LUKS2
close/reopen validation remains a separate isolated-host test; CI does not claim
to repeat that privileged storage test.

## Deletion protocol

All endpoints require the selected network and TLS outside isolated loopback.
Credentials have the upstream shape `{address, view_key}`. Only the private view
key is shared; no seed, private spend key or client key image is accepted.

1. Stop the client's scan and prevent automatic login/re-registration. Preserve
   its encrypted checkpoint, labels, transfer journal and independent recovery.
2. POST credentials to `/prepare_account_delete`. The server returns a random
   32-byte hex `token`, stable while that authorization belongs to the same
   registration. A pending creation request can also be deleted. An already absent
   account receives an absence-check token without creating a registration or
   retaining credentials; unfinished cleanup returns its existing token.
3. POST `{address, view_key, token}` to `/delete_account`. Authentication,
   generation validation, removal of account/request view keys and indexes,
   token consumption and durable cleanup enqueue are one writer transaction.
4. `{complete:false}` means live credentials are removed but index cleanup is
   pending. Unknown tokens cannot acknowledge completion while that address has
   pending cleanup. Retry the same token; never report complete deletion on a
   timeout
   or transport failure. `{complete:true}` means the live database cleanup is
   complete. Background cleanup resumes after restart without client requests.
5. Re-registration needs a fresh authorization before another deletion. A
   recorded old token cannot delete that new registration. Tokens are invalidated
   on new registration and pending-request rejection. View-key knowledge itself
   cannot be revoked; a party retaining it can deliberately register again.

Each cleanup transaction removes at most 256 account-scoped records plus bounded
auxiliary image-reference/index records. It holds no RPC, upload or user wait.
Shared image references survive until their last referencing account is removed.
Monotonic account IDs prevent old scan/subaddress operations from writing into a
new registration. Workers replace removed accounts on the existing ten-second
poll; in-flight work may finish, but cannot recreate deleted database rows.
Mempool address-cache invalidation fences writes from older cache scans.

The browser persists a deletion intent before preparing the token, then persists
that token before sending deletion. Sync stays disabled across reopen and v4
backup restore until explicit service consent. The selected endpoint cannot be
re-registered while its deletion is pending. Older endpoint intents remain
recoverable when selecting another scanner; accepted intents are never silently
dropped. Retry work and the pending queue have explicit bounds.

## Database compatibility

The fork adds versioned tables for the ID counter, deletion authorizations,
cleanup queue with its per-address pending index, and shared image references.
First use requires an empty upstream
account/request/output/spend/image/subaddress database. Non-empty upstream data
is rejected; no automatic migration or real-account data conversion is provided.
Fork databases must not be opened by an upstream binary that ignores these
invariants. Rollback uses the matching binary and an approved matching encrypted
snapshot, never a binary-only downgrade. The selected first stage has no scanner
database backup.

## Protected storage tests

`check-protected-mount.sh MOUNT_DIRECTORY MAPPER_NAME` is a read-only preflight:
require the exact mounted LUKS2 mapping, mode 0700, and `rw,nodev,nosuid,noexec`.
It never creates a plaintext fallback. Unlock/close remains an explicit operator
operation. Do not add boot unlock keys, fstab entries or shared service changes.

`storage-probe.cpp` creates only a disposable registration and authorization on
that guarded mount. After the process exits, the operator closes and reopens the
volume. Its second phase recovers the registration, deletes it, re-registers,
rejects the old token and deletes the replacement. Fixture credentials stay
inside the encrypted test filesystem and are removed after validation. The unit
fixture's `LWS_TEST_DATABASE` override is for an isolated test directory only.
It must never point at an existing service database.

## Limits of deletion

Deleting LMDB records is logical deletion, not guaranteed physical erasure.
Copy-on-write/free pages, filesystem snapshots, host storage and old backups can
retain bytes. A mounted volume remains readable to host root. LUKS2 protects the
closed volume; it cannot revoke one account's key or retract knowledge already
learned by an operator. No immediate forensic-erasure or backup-expiry guarantee
is made. The selected first stage has no database backups and retains
registrations until requested deletion. Complete client deletion, key handoff and
service review before non-disposable or public use. Keep infrastructure inventories, paths, credentials and evidence
outside Git.

## Assembled browser fixture

`rest-fixture.cpp` runs the pinned real HTTP/database modules in stagenet on
container loopback with a tmpfs database. It is test-only and has no chain scanner
or public listener. `test/browser/check-scanner-deletion.cjs` uses a disposable
extension profile to exercise lost-response recovery, encrypted backup reopen,
registration suppression and local-label preservation. Scanner concurrency and
actual encrypted remount recovery are covered separately by the native and LUKS2
contracts; this UI test does not claim to repeat chain receipt/spending tests.
