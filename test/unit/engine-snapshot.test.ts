import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSnapshot, encodeSnapshot } from '../../src/engine/snapshot.ts';
import type { EngineSnapshot } from '../../src/engine/snapshot.ts';
import { createIntent } from '../../src/transactions/index.ts';
import fs from 'node:fs/promises';

const fixture: EngineSnapshot = {
  metadata: {
    version: 1,
    network: 'stagenet',
    restoreHeight: 12345,
    backupVerified: true,
    enginePassword: 'a'.repeat(64),
    node: { uri: 'https://node.example', username: '', password: 'fixture' },
    pending: null,
  },
  keys: Uint8Array.of(1, 2, 3),
  cache: Uint8Array.of(4, 5, 6),
};

void test('engine snapshot preserves all recovery metadata and independent byte arrays', () => {
  const encoded = encodeSnapshot(fixture);
  const decoded = decodeSnapshot(encoded);
  assert.deepEqual(decoded, fixture);
  new Uint8Array(encoded).fill(0);
  assert.deepEqual(decoded.keys, fixture.keys);
});

void test('truncated and ambiguous engine payloads cannot reach the native parser', () => {
  assert.throws(() => encodeSnapshot({ ...fixture, keys: new Uint8Array(0) }));
  const encoded = encodeSnapshot(fixture);
  for (const length of [0, 15, encoded.byteLength - 1]) {
    assert.throws(() => decodeSnapshot(encoded.slice(0, length)));
  }
  const oversizedLength = encoded.slice(0);
  new DataView(oversizedLength).setUint32(8, 0xffffffff);
  assert.throws(() => decodeSnapshot(oversizedLength));
  const wrongVersion = encoded.slice(0);
  new DataView(wrongVersion).setUint32(0, 3);
  assert.throws(() => decodeSnapshot(wrongVersion));
});

void test('large pending transaction data survives a recovery snapshot without consuming the metadata budget', () => {
  const intent = createIntent({ address: '5'.repeat(95), amount: '100', maximumFee: '10' });
  for (const status of ['prepared', 'unknown'] as const) {
    const pending = {
      intent,
      fee: '1',
      status,
      unsignedHex: status === 'prepared' ? 'ab'.repeat(100_000) : '',
      signedHex: status === 'unknown' ? 'cd'.repeat(100_000) : '',
      hash: status === 'unknown' ? 'a'.repeat(64) : '',
    };
    const decoded = decodeSnapshot(
      encodeSnapshot({ ...fixture, metadata: { ...fixture.metadata, pending } }),
    );
    assert.deepEqual(decoded.metadata.pending, pending);
    assert.deepEqual(decoded.keys, fixture.keys);
    assert.deepEqual(decoded.cache, fixture.cache);
  }
});

void test('the original version-1 snapshot fixture remains readable', async () => {
  const stored: unknown = JSON.parse(
    await fs.readFile(new URL('../fixtures/engine-v1-snapshot.json', import.meta.url), 'utf8'),
  );
  assert.ok(
    typeof stored === 'object' &&
      stored !== null &&
      'base64' in stored &&
      typeof stored.base64 === 'string',
  );
  const bytes = Buffer.from(stored.base64, 'base64');
  assert.deepEqual(decodeSnapshot(Uint8Array.from(bytes).buffer), fixture);
});
