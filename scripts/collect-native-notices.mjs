import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const workspace = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const source = 'monero-ts';
const cpp = `${source}/external/monero-cpp`;
const core = `${cpp}/external/monero-project`;
const runtime = 'emsdk/upstream/emscripten/system/lib';
const notices = [
  ['monero-ts', `${source}/LICENSE.txt`],
  ['monero-cpp', `${cpp}/LICENSE.txt`],
  ['Monero and CryptoNote', `${core}/LICENSE`],
  ['epee', `${core}/contrib/epee/LICENSE.txt`],
  ['RapidJSON', `${core}/external/rapidjson/license.txt`],
  ['LMDB license', `${core}/external/db_drivers/liblmdb/LICENSE`],
  ['LMDB copyright', `${core}/external/db_drivers/liblmdb/COPYRIGHT`],
  ['Boost', `${cpp}/external/boost-sdk/libs/geometry/LICENSE_1_0.txt`],
  ['Emscripten', 'emsdk/upstream/emscripten/LICENSE'],
  ['musl libc', `${runtime}/libc/musl/COPYRIGHT`],
  ['LLVM libc++', `${runtime}/libcxx/LICENSE.TXT`],
  ['LLVM libc++abi', `${runtime}/libcxxabi/LICENSE.TXT`],
  ['LLVM compiler runtime', `${runtime}/compiler-rt/LICENSE.TXT`],
  ['OpenSSL headers (no linked OpenSSL library)', 'openssl-3.5.9/LICENSE.txt'],
];

const pinnedNotices = [
  [
    'libsodium 1.0.18',
    'inputs/libsodium-1.0.18-LICENSE',
    'dea1855c9809f3faf22aa4a1fba20ec8af5a5587f23115012e5b98279cedc4af',
  ],
  [
    'Easylogging++ 9.96.7',
    'inputs/easyloggingpp-9.96.7-LICENSE',
    'bd30b865b9808a6637145bf02df92c06b0c21307e170f4bdf30b2e277f6cda35',
  ],
];

const entries = [];
for (const [component, filename] of notices) entries.push(await readNotice(component, filename));
for (const [component, filename, hash] of pinnedNotices)
  entries.push(await readNotice(component, filename, hash));
for (const filename of ['oaes_lib.c', 'skein.c', 'chacha.c']) {
  const sourceText = await fs.readFile(path.join(workspace, core, 'src/crypto', filename), 'utf8');
  const header = sourceText.match(/^\/\*[\s\S]*?\*\//)?.[0];
  if (!header) throw new Error(`Missing native notice: ${filename}`);
  entries.push(`\n=== ${filename}: original source notice ===\n${header}\n`);
}
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'native-NOTICES.txt'), entries.join('\n'));
console.log(`Collected ${String(entries.length)} native notices.`);

async function readNotice(component, filename, expectedHash) {
  const data = await fs.readFile(path.join(workspace, filename));
  if (data.byteLength === 0 || data.byteLength > 128 * 1024)
    throw new Error('Invalid license input.');
  const hash = createHash('sha256').update(data).digest('hex');
  if (expectedHash && hash !== expectedHash)
    throw new Error(`License input hash mismatch: ${component}`);
  return `\n=== ${component} ===\nSource: ${filename}\nSHA-256: ${hash}\n\n${data.toString('utf8')}\n`;
}
