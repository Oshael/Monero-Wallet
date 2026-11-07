import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntent, TransferJournal } from '../../src/transactions/index.ts';
import type { PendingTransfer } from '../../src/transactions/index.ts';

function prepared(): PendingTransfer {
  return {
    intent: createIntent({ address: '5'.repeat(95), amount: '100', maximumFee: '10' }),
    fee: '1',
    unsignedHex: '00',
    signedHex: '',
    hash: '',
    status: 'prepared',
  };
}

void test('only one unsigned intent can be active and caller mutation cannot change it', () => {
  const journal = new TransferJournal(null);
  const transfer = prepared();
  journal.prepared(transfer);
  transfer.fee = '9';
  assert.equal(journal.snapshot()?.fee, '1');
  const view = journal.view();
  assert.ok(view);
  assert.equal('unsignedHex' in view || 'signedHex' in view, false);
  view.amount = '999';
  assert.equal(journal.snapshot()?.intent.amount, '100');
  assert.throws(
    () => {
      journal.prepared(prepared());
    },
    { code: 'pending-transfer' },
  );
  assert.throws(() => {
    journal.signed(crypto.randomUUID(), { signedHex: 'aa', hash: 'a'.repeat(64) });
  });
});

void test('uncertain broadcast survives restart and prevents a new spend or cancellation', () => {
  const original = prepared();
  const journal = new TransferJournal(null);
  journal.prepared(original);
  journal.signed(original.intent.id, { signedHex: 'aabb', hash: 'a'.repeat(64) });
  journal.arm(original.intent.id);
  journal.arm(original.intent.id);
  assert.equal(journal.snapshot()?.signedHex, 'aabb');
  const restored = new TransferJournal(journal.snapshot());
  assert.equal(restored.snapshot()?.status, 'unknown');
  assert.equal(restored.snapshot()?.signedHex, 'aabb');
  assert.throws(() => {
    restored.assertCanPrepare();
  });
  assert.throws(() => {
    restored.cancel(original.intent.id);
  });
  restored.arm(original.intent.id);
  restored.broadcastResult(original.intent.id, false);
  assert.equal(restored.snapshot()?.status, 'unknown');
  restored.observed(original.intent.id, true);
  restored.assertCanPrepare();
  restored.unobserved(original.intent.id);
  assert.equal(restored.snapshot()?.status, 'unknown');
  assert.equal(restored.snapshot()?.signedHex, 'aabb');
  assert.throws(() => {
    restored.assertCanPrepare();
  });
  restored.observed(original.intent.id, true);
  restored.assertCanPrepare();
});

void test('a used approval and an unarmed broadcast cannot be replayed', () => {
  const original = prepared();
  const journal = new TransferJournal(null);
  journal.prepared(original);
  assert.throws(() => {
    journal.broadcastResult(original.intent.id, true);
  });
  journal.signed(original.intent.id, { signedHex: 'aabb', hash: 'a'.repeat(64) });
  assert.throws(() => {
    journal.signed(original.intent.id, { signedHex: 'cc', hash: 'b'.repeat(64) });
  });
});
