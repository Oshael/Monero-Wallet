import assert from 'node:assert/strict';
import test from 'node:test';
import { readChainState } from '../../src/engine/chain-state.ts';
import { decodeNodeStatus } from '../../src/domain/node-status.ts';

void test('spend freshness requires the wallet and selected daemon to reach the known network tip', async () => {
  const cases = [
    { wallet: 100, daemon: 100, peer: 100, ready: true, synced: true },
    { wallet: 100, daemon: 100, peer: 110, ready: false, synced: false },
    { wallet: 100, daemon: 100, peer: 110, ready: true, synced: false },
    { wallet: 110, daemon: 100, peer: 110, ready: true, synced: false },
    { wallet: 90, daemon: 100, peer: 100, ready: true, synced: false },
    { wallet: 101, daemon: 100, peer: 100, ready: true, synced: false },
    { wallet: 100, daemon: 100, peer: 100, ready: false, synced: false },
    { wallet: 0, daemon: 0, peer: 0, ready: true, synced: false },
  ];
  for (const scenario of cases) {
    const result = await readChainState({ getHeight: () => Promise.resolve(scenario.wallet) }, () =>
      Promise.resolve({
        height: scenario.daemon,
        targetHeight: scenario.peer,
        synced: scenario.ready,
      }),
    );
    assert.equal(result.synced, scenario.synced);
    assert.equal(result.targetHeight, Math.max(scenario.daemon, scenario.peer));
  }
});

void test('node status rejects wrong networks, malformed heights and unknown synchronization', () => {
  const valid = {
    status: 'OK',
    nettype: 'stagenet',
    height: 10,
    target_height: 10,
    synchronized: true,
  };
  assert.equal(decodeNodeStatus(valid, 'stagenet').synced, true);
  for (const change of [
    { nettype: 'mainnet' },
    { status: 'BUSY' },
    { height: -1 },
    { synchronized: 'true' },
    { target_height: 1.1 },
  ])
    assert.throws(() => decodeNodeStatus({ ...valid, ...change }, 'stagenet'));
});
