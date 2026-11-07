import assert from 'node:assert/strict';
import test from 'node:test';
import { SendWorkflow } from '../../src/session/send.ts';
import type { WalletView } from '../../src/domain/wallet-view.ts';

const view: WalletView = {
  address: '',
  height: 1,
  targetHeight: 1,
  balance: '1',
  unlockedBalance: '1',
  sync: 'synced',
  backupVerified: true,
  pending: null,
};

void test('broadcast cannot reach the node until its recovery checkpoint is durable', async () => {
  let networkCalls = 0;
  let durable = false;
  const workflow = new SendWorkflow(
    {
      prepareSend: () => Promise.reject(new Error('Unused fixture operation.')),
      snapshot: () => Promise.resolve(new ArrayBuffer(0)),
      transfer: (command) => {
        if (command.kind === 'broadcast-send') {
          assert.equal(durable, true);
          networkCalls++;
        }
        return Promise.resolve(view);
      },
    },
    {
      save: () => {
        if (!durable) return Promise.reject(new Error('Storage unavailable.'));
        return Promise.resolve();
      },
    },
  );
  await assert.rejects(workflow.broadcast('fixture'), /Storage unavailable/);
  assert.equal(networkCalls, 0);
  durable = true;
  await workflow.broadcast('fixture');
  assert.equal(networkCalls, 1);
});
