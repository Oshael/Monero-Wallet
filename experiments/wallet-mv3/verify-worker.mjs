import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const [
  ,
  ,
  source,
  expectedGlueSha256 = '258a065899deec0172fec24de9d3e65a9fa2a10499185b72112f52dcf5bc8433',
] = process.argv;
if (!source) throw new Error('Pass the path to the built monero-ts source directory.');
assert.match(expectedGlueSha256, /^[a-f0-9]{64}$/, 'Expected a SHA-256 digest for the WASM glue.');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function modernWasm(script) {
  // Reuse Webpack's locked parser to read the compiler's binary string literal without eval.
  const require = createRequire(import.meta.url);
  const { parse } = require(resolve(source, 'node_modules/acorn'));
  const pending = [parse(script, { ecmaVersion: 'latest', sourceType: 'module' })];
  let encoded;
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (isWasmLiteral(node)) {
      assert.equal(encoded, undefined, 'Multiple native payloads are ambiguous.');
      encoded = node.value;
    }
    pending.push(...Object.values(node));
  }
  assert.ok(encoded, 'Embedded native binary string is missing.');
  // Emscripten 6 binaryDecode: recover the byte represented by each encoded code point.
  return Uint8Array.from({ length: encoded.length }, (_, index) => {
    const value = encoded.charCodeAt(index);
    return (~value >> 8) & value;
  });
}

function isWasmLiteral(node) {
  return (
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    node.value.length > 8 &&
    node.value.startsWith('\0asm')
  );
}

function readWasm(script) {
  const match = script.match(
    /data:application\/octet-stream;base64,((?:H4sI|AGFzbQ)[A-Za-z0-9+/=]+)/,
  );
  const payload = match ? Buffer.from(match[1], 'base64') : modernWasm(script);
  const wasm = match?.[1].startsWith('H4sI') ? gunzipSync(payload) : payload;
  assert.ok(WebAssembly.validate(wasm), 'Embedded WASM payload is invalid.');
  return wasm;
}

const wasmGlue = readFileSync(join(source, 'dist/monero.js'), 'utf8');
const worker = readFileSync(join(source, 'dist/monero.worker.js'), 'utf8');
const map = JSON.parse(readFileSync(join(source, 'dist/monero.worker.js.map'), 'utf8'));
const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
const axiosModule = map.sources.findIndex((file) => file.endsWith('/axios/lib/env/data.js'));
const wasmSha256 = sha256(readWasm(worker));

assert.equal(sha256(wasmGlue), expectedGlueSha256, 'WASM glue differs from the expected artifact.');
assert.equal(wasmSha256, sha256(readWasm(wasmGlue)), 'The worker changed the native WASM.');
assert.ok(axiosModule >= 0, 'The Axios version module is missing.');
assert.match(map.sourcesContent[axiosModule], /VERSION\s*=\s*['"]1\.21\.0['"]/);

const qsPaths = new Set(
  map.sources.flatMap((file) => {
    const match = file.match(/\/(node_modules\/(?:url\/node_modules\/)?qs)\//);
    return match ? [match[1]] : [];
  }),
);
assert.ok(qsPaths.size > 0, 'The URL shim has no identifiable qs module.');
for (const modulePath of qsPaths) assert.equal(lock.packages[modulePath]?.version, '6.17.1');

const excluded = [
  'browserify-sign',
  'cipher-base',
  'crypto-browserify',
  'elliptic',
  'pbkdf2',
  'sha.js',
];
for (const name of excluded) {
  assert.ok(
    map.sources.every((file) => !file.includes(`/node_modules/${name}/`)),
    `${name} is bundled in the browser worker.`,
  );
}

console.log(
  JSON.stringify({ workerSha256: sha256(worker), bytes: Buffer.byteLength(worker), wasmSha256 }),
);
