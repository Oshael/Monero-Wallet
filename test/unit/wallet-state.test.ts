import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeWalletState } from '../../src/engine/wallet-state.ts';

function fixture() {
  const values = {
    walletHeight: 100,
    nodeHeight: 100,
    targetHeight: 100,
    ready: true,
    balance: 10n,
    unlocked: 7n,
    balanceFailure: false,
  };
  const wallet = {
    getHeight: () => Promise.resolve(values.walletHeight),
    getBalance: () =>
      values.balanceFailure
        ? Promise.reject(new Error('Native balance unavailable.'))
        : Promise.resolve(values.balance),
    getUnlockedBalance: () => Promise.resolve(values.unlocked),
  };
  return {
    values,
    create: () =>
      NativeWalletState.create(wallet, () =>
        Promise.resolve({
          height: values.nodeHeight,
          targetHeight: values.targetHeight,
          synced: values.ready,
        }),
      ),
  };
}

void test('broadcast refreshes local balances and invalidates spend freshness until another scan', async () => {
  const setup = fixture();
  const state = await setup.create();
  state.startScan();
  assert.equal(await state.canScan(), true);
  await state.completeScan();
  await state.assertSpendable();
  setup.values.balance = 4n;
  setup.values.unlocked = 1n;
  await state.afterBroadcast();
  assert.equal(state.view().balance, '4');
  assert.equal(state.view().unlockedBalance, '1');
  assert.equal(state.status, 'offline');
  await assert.rejects(state.assertSpendable(), { code: 'synchronization-required' });
  const view = state.view();
  view.balance = '999';
  assert.equal(state.view().balance, '4');
});

void test('behind nodes cannot start a native scan and a changed tip blocks cached spendability', async () => {
  const setup = fixture();
  setup.values.ready = false;
  setup.values.targetHeight = 200;
  const state = await setup.create();
  state.startScan();
  assert.equal(await state.canScan(), false);
  assert.equal(state.status, 'waiting-node');
  setup.values.ready = true;
  setup.values.targetHeight = 100;
  state.startScan();
  await state.completeScan();
  setup.values.nodeHeight = 101;
  setup.values.targetHeight = 101;
  await assert.rejects(state.assertSpendable(), { code: 'synchronization-required' });
});

void test('a failed post-broadcast balance read leaves the prior numbers explicitly stale', async () => {
  const setup = fixture();
  const state = await setup.create();
  await state.completeScan();
  setup.values.balanceFailure = true;
  await assert.rejects(state.afterBroadcast(), /Native balance unavailable/);
  assert.equal(state.status, 'offline');
  assert.equal(state.view().balance, '10');
  assert.equal(state.view().unlockedBalance, '7');
});
