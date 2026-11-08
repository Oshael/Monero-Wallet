# Browser wallet development

This repository contains an unpublished Chromium Manifest V3 stagenet wallet,
its architecture plan and feasibility experiments. The integrated light-wallet
model scans on the selected project service while seed/private spend keys,
validation and signing stay in extension-owned workers. Sensitive client state
is encrypted in IndexedDB. The scanner intentionally receives the private view
key after consent and can observe incoming payments. See the
[adoption record](docs/LIGHT_WALLET_ADOPTION.md). No public scanner is activated.

- [Architecture, security and delivery plan](MONERO_WALLET_PROJECT_PLAN.md)
- [Manifest V3, recovery, entropy and worker build experiments](experiments/wallet-mv3/README.md)
- [Wallet implementation and verification](docs/WALLET_IMPLEMENTATION.md)
- [Native dependency provenance and notices](docs/NATIVE_DEPENDENCIES.md)
- [Build and test the wallet](docs/WALLET_DEVELOPMENT.md)
- [Protected scanner storage and deletion](docs/LIGHT_SERVICE_DELIVERY.md)
- [Pinned LWS build and deletion contracts](experiments/lws/README.md)

Creation, encrypted backup/import, password rotation, subaddresses and exclusive
session locking passed in Chromium. Authenticated scanner deletion also passed
its uncertain-result, encrypted-backup and no-automatic-registration UI contracts. A funded disposable-chain test passed local
unsigned preparation, inspection before and after signing, relay, exact receipt,
integrated addresses and recovery from a detached confirmation. CLI seed recovery
and browser entropy checks passed. Assembled live-stagenet phases also confirmed
receipt, sending and recovery of a lost broadcast response using the same signed
transaction. Initial desktop new-wallet/recent-restore measurements are recorded.
Historical restoration, mainnet-scale capacity and independent security review
remain open; see the implementation record for exact datasets and limitations.

Use an isolated build environment and preserve unrelated projects. Resource use
must follow this project's current owner approvals. Infrastructure access details
and operational evidence belong in the ignored `.local/` directory. Source pushes
do not deploy or activate a public service. Mainnet money use is not enabled.
