# Native candidate provenance and notices

This is an experimental maintained build of the same wallet engine. It does not
introduce substitute cryptography. The application does not enable mainnet.

| Input                                | Pinned revision                                        | License                                           |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| monero-ts 0.11.22                    | `f6569ca616c4723645a7bfae3a843a0358f5fca9`             | MIT                                               |
| monero-cpp                           | `4c9485daaed03261c0ba7103b0fca44a65948077`             | MIT                                               |
| Monero core fork                     | `3e9d5d24d52b2427ace10c115e13c58df90ef796`             | BSD-3-Clause, with notices for incorporated code  |
| Emscripten SDK 6.0.13                | `35659964bc2762fffec0d257997fb61475f765b7`             | MIT/LLVM and runtime notices                      |
| Boost 1.83.0                         | Verified archive in the native recipe                  | BSL-1.0                                           |
| Vendored libsodium sources           | Byte-identical to the three sources in official 1.0.18 | ISC                                               |
| epee, RapidJSON, LMDB, Easylogging++ | Sources within the pinned native tree                  | BSD/MIT/OpenLDAP-2.8; preserve individual notices |
| OpenAES, Skein, ChaCha               | Sources within the pinned Monero tree                  | BSD-2-Clause/public-domain notices                |

The compiled libsodium sources are `crypto_verify/verify.c`,
`crypto_shorthash/siphash24/shorthash_siphash24.c` and
`crypto_shorthash/siphash24/ref/shorthash_siphash24_ref.c`. Their SHA-256 values
match the official 1.0.18 source files (the first is under `crypto_verify/sodium`
in that release): `2af44fcbde7abb7aacba6629689d19fea98b8dda19fd7d53c3186c077ee97e86`,
`72465eaaa527e9d42b2d6dd645069b64e30402de973cc972f114688c85ef7c83` and
`04f3d382837c2589d3959ff44351b716e55c16a886297aefcda0b77b272d5796`.
This identifies provenance; it is not a security audit or a dependency update.
[Official ISC notice](https://github.com/jedisct1/libsodium/blob/1.0.18/LICENSE).

The native patches cover current compiler options, explicit browser globals,
serialization compatibility and the existing descriptor's signed-set parser.
The JavaScript patch bounds HTTP requests and converts/releases current
Emscripten exception objects using its official runtime helpers. The latter
requires the matching project-built WASM; do not combine this JavaScript patch
with the older published WASM. [Emscripten exception handling](https://emscripten.org/docs/porting/exceptions.html).

Run `scripts/collect-native-notices.mjs` with the native workspace and vendor
output directory. It collects upstream license texts, runtime notices and
original crypto notices; it verifies the two separately downloaded notice inputs.
`npm run build` requires that generated file and includes the noble-hashes license.
Generated Webpack/esbuild dependency notices must also accompany the extension.
`collect-client-notices.cjs` identifies dependency roots from the actual ESM
source map and includes their complete license texts. The final candidate had
62 such roots, using MIT, ISC, BSD-3-Clause, Apache-2.0 or 0BSD metadata. An audit
of the full lockfile reported 26 advisories in development dependencies; none
matched a shipped package root. This is a scoped dependency check, not a native
security review or a guarantee against unreported vulnerabilities.
No project-wide distribution license is selected by this document.

The inherited missing native functions remain aborting stubs. Tested creation,
data export/reopen, scan, cold signing and relay paths do not exercise them.
The public application interface exposes neither native files, hardware wallets,
mining/RPC payments, PEM export nor a native notifier. This reduces reachable
surface; it does not prove every parser path is safe. Independent review of the
native fork, licensed inputs and shipping bundle remains required before public
money use. No success-returning stub was introduced.
