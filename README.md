# Browser wallet development

This repository contains an unpublished Chromium Manifest V3 stagenet wallet,
its architecture plan and feasibility experiments. Keys, scanning and signing
stay in extension-owned workers; sensitive state is encrypted in IndexedDB.

- [Architecture, security and delivery plan](MONERO_WALLET_PROJECT_PLAN.md)
- [Manifest V3, recovery, entropy and worker build experiments](experiments/wallet-mv3/README.md)
- [Wallet implementation and verification](docs/WALLET_IMPLEMENTATION.md)
- [Native dependency provenance and notices](docs/NATIVE_DEPENDENCIES.md)
- [Build and test the wallet](docs/WALLET_DEVELOPMENT.md)

Creation, encrypted backup/import, password rotation, subaddresses and exclusive
session locking passed in Chromium. A funded disposable-chain test passed local
unsigned preparation, inspection before and after signing, relay, exact receipt,
integrated addresses and recovery from a detached confirmation. CLI seed recovery
and browser entropy checks passed. Funded live-stagenet validation, representative
large-history measurements and independent security review remain open.

Use an isolated build environment and preserve unrelated projects. Resource use
must follow this project's current owner approvals. Infrastructure access details
and operational evidence belong in the ignored `.local/` directory. Source pushes
do not deploy or activate a public service. Mainnet money use is not enabled.
