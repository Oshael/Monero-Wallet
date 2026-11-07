# Browser wallet feasibility

This repository contains the architecture plan and Gate A experiments for a browser-owned Monero wallet. Engine adoption and the swap route remain under review.

- [Architecture, security and delivery plan](MONERO_WALLET_PROJECT_PLAN.md)
- [Manifest V3, recovery, entropy and worker build experiments](experiments/wallet-mv3/README.md)

The native WASM was compiled from pinned sources in an isolated container and bundled with the project worker. Offline creation, independent CLI recovery, entropy checks and loopback RPC tests passed in Chromium. Authenticated RPC and a one-block regtest synchronization passed against the official daemon after a browser transport correction. Native dependency, toolchain and unresolved-function review, encrypted persistence and representative synchronization measurements remain pending.

Run the native compiler in a project-owned container or VM. Its prerequisites and commands are documented in the experiment. Remote checkout and build operations must use a dedicated directory and explicit resource limits. Infrastructure access details and operational evidence belong in the ignored `.local/` directory.
