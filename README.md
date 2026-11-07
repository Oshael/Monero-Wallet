# Browser wallet feasibility

This repository contains the architecture plan and Gate A experiments for a browser-owned Monero wallet. Engine adoption and the swap route remain under review.

- [Architecture, security and delivery plan](MONERO_WALLET_PROJECT_PLAN.md)
- [Manifest V3, recovery, entropy and worker build experiments](experiments/wallet-mv3/README.md)

The JavaScript worker build passed the documented offline and loopback checks. The native WASM source build was interrupted before completion when the owner moved compilation to a VPS. Native runtime validation remains pending.

Run the native compiler in a project-owned container or VM. Its prerequisites and commands are documented in the experiment. Remote checkout and build operations must use a dedicated directory and explicit resource limits. Infrastructure access details and operational evidence belong in the ignored `.local/` directory.
