import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLightWalletData } from '../../src/engine/light-wallet/data.ts';

const transactionHash = 'ab'.repeat(32);

function fixture() {
  return {
    node: { height: 201, targetHeight: 0, synced: true },
    info: { scanned_block_height: 200, blockchain_height: 200 },
    transactions: {
      scanned_block_height: 200,
      blockchain_height: 200,
      transactions: [
        { hash: transactionHash, height: 190, unlock_time: 0, coinbase: false, mempool: false },
      ],
    },
    outputs: {
      outputs: [
        {
          amount: '18446744073709551615',
          public_key: '12'.repeat(32),
          index: 2,
          global_index: '9007199254740993',
          tx_hash: transactionHash,
          tx_pub_key: '34'.repeat(32),
          spend_key_images: [],
          height: 190,
          timestamp: '2026-11-07T12:00:00Z',
          recipient: { maj_i: 0, min_i: 3 },
          rct: '56'.repeat(96),
        },
      ],
    },
  };
}

await test('light response decoding preserves uint64 precision and subaddress ownership claims', () => {
  const result = decodeLightWalletData(fixture());
  assert.equal(result.height, 201);
  const output = result.outputs[0];
  assert.ok(output);
  assert.equal(output.amount, '18446744073709551615');
  assert.equal(output.global_index, '9007199254740993');
  assert.deepEqual(output.recipient, { major: 0, minor: 3 });
  assert.deepEqual(result.confirmed, [{ hash: transactionHash, height: 190 }]);
});

await test('behind or changing light scans cannot establish current spending state', () => {
  const behind = fixture();
  behind.info.scanned_block_height = 199;
  assert.throws(() => decodeLightWalletData(behind), /light-scanner-behind/);
  const changing = fixture();
  changing.transactions.scanned_block_height = 201;
  changing.transactions.blockchain_height = 201;
  assert.throws(() => decodeLightWalletData(changing), /light-scan-changed/);
  const behindNode = fixture();
  behindNode.node.height = 202;
  assert.throws(() => decodeLightWalletData(behindNode), /light-scanner-behind/);
  const syncingNode = fixture();
  syncingNode.node.synced = false;
  assert.throws(() => decodeLightWalletData(syncingNode), /light-scanner-behind/);
});

await test('light outputs require consistent confirmed history and valid encoding', () => {
  const missing = fixture();
  missing.transactions.transactions = [];
  assert.throws(() => decodeLightWalletData(missing), /invalid-light-data/);
  const unconfirmed = fixture();
  const entry = unconfirmed.transactions.transactions[0];
  assert.ok(entry);
  entry.mempool = true;
  assert.throws(() => decodeLightWalletData(unconfirmed), /invalid-light-data/);
  const malformed = fixture();
  const output = malformed.outputs.outputs[0];
  assert.ok(output);
  output.rct = '00';
  assert.throws(() => decodeLightWalletData(malformed), /invalid-light-data/);
});

await test('unsafe JSON numbers cannot silently change a light-wallet amount', () => {
  const input = fixture();
  const output = input.outputs.outputs[0];
  assert.ok(output);
  assert.throws(
    () =>
      decodeLightWalletData({
        ...input,
        outputs: { outputs: [{ ...output, amount: 9_007_199_254_740_992 }] },
      }),
    /invalid-light-data/,
  );
});

await test('omitted empty LWS candidate-spend lists are accepted while malformed lists are rejected', () => {
  const input = fixture();
  const output: Record<string, unknown> = { ...input.outputs.outputs[0] };
  delete output.spend_key_images;
  const decoded = decodeLightWalletData({ ...input, outputs: { outputs: [output] } });
  assert.deepEqual(decoded.outputs[0]?.spend_key_images, []);
  assert.throws(
    () =>
      decodeLightWalletData({
        ...input,
        outputs: { outputs: [{ ...output, spend_key_images: null }] },
      }),
    /invalid-light-spend-key-images/,
  );
});

await test('incomplete output subaddress scans and malformed empty collections are rejected', () => {
  const input = fixture();
  assert.throws(
    () => decodeLightWalletData({ ...input, outputs: { ...input.outputs, lookahead_fail: 1 } }),
    /light-subaddress-scan-incomplete/,
  );
  assert.throws(
    () => decodeLightWalletData({ ...input, outputs: { outputs: null } }),
    /invalid-light-outputs/,
  );
  assert.throws(
    () =>
      decodeLightWalletData({
        ...input,
        transactions: { ...input.transactions, transactions: null },
      }),
    /invalid-light-transactions/,
  );
});
