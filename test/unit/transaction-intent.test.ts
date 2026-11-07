import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntent, inspectTransaction } from '../../src/transactions/intent.ts';
import type { InspectedTransaction } from '../../src/transactions/intent.ts';

const address = '5'.repeat(95);
const intent = createIntent({ address, amount: '1000000000000', maximumFee: '1000000000' });
const transaction: InspectedTransaction = {
  destinations: [{ address, amount: intent.amount }],
  fee: '10000000',
  changeAddress: 'own address',
  changeAmount: '2000000000000',
  unlockTime: '0',
};

void test('a locally described transaction must match the immutable intent', () => {
  assert.ok(Object.isFrozen(intent));
  inspectTransaction({ intent, transaction, ownsChange: true });
});

void test('standard, subaddress and integrated address lengths reach native checksum validation', () => {
  for (const length of [95, 106]) {
    assert.equal(
      createIntent({ address: '5'.repeat(length), amount: '1', maximumFee: '1' }).address.length,
      length,
    );
  }
  for (const length of [94, 96, 105, 107]) {
    assert.throws(() =>
      createIntent({ address: '5'.repeat(length), amount: '1', maximumFee: '1' }),
    );
  }
});

void test('recipient substitution, extra outputs, fees, locktimes and expiry block signing', () => {
  const cases: InspectedTransaction[] = [
    { ...transaction, destinations: [{ address: '9'.repeat(95), amount: intent.amount }] },
    { ...transaction, destinations: [{ address, amount: '1' }] },
    { ...transaction, destinations: [...transaction.destinations, { address, amount: '1' }] },
    { ...transaction, fee: '1000000001' },
    { ...transaction, unlockTime: '1' },
  ];
  for (const candidate of cases) {
    assert.throws(() => {
      inspectTransaction({ intent, transaction: candidate, ownsChange: true });
    });
  }
  assert.throws(() => {
    inspectTransaction({ intent, transaction, ownsChange: false });
  });
  assert.throws(() => {
    inspectTransaction({ intent, transaction, ownsChange: true, now: intent.expiresAt + 1 });
  });
});
