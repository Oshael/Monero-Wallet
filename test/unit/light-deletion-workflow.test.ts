import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightDeletionWorkflow } from '../../src/session/light-deletion.ts';
import type { WalletView } from '../../src/domain/wallet-view.ts';

function fixture() {
  let stage = 'initial';
  let persisted = '';
  let saves = 0;
  let failSave = 0;
  let deletions = 0;
  let prepares = 0;
  let pending = 1;
  let reportFailure = false;
  let complete = true;
  const view = (): WalletView => ({
    address: 'disposable',
    height: 100,
    targetHeight: 100,
    balance: '7',
    unlockedBalance: '5',
    sync: 'offline',
    backupVerified: true,
    pending: null,
    lightService: {
      uri: 'https://scanner.example',
      phase: pending ? 'deleting' : 'deleted',
      pendingDeletions: pending,
      deletionOrigins: pending ? ['https://scanner.example'] : [],
    },
  });
  const engine = {
    requestLightDeletion: () => {
      stage = 'requested';
      return Promise.resolve(view());
    },
    prepareLightDeletion: () => {
      prepares++;
      stage = 'prepared-with-stable-token';
      return Promise.resolve(view());
    },
    finishLightDeletion: () => {
      assert.equal(
        persisted,
        'prepared-with-stable-token',
        'server deletion requires durable authorization',
      );
      deletions++;
      if (reportFailure) return Promise.reject(new Error('Unknown server result'));
      if (complete) {
        pending = 0;
        stage = 'confirmed';
      }
      return Promise.resolve(view());
    },
    snapshot: () => Promise.resolve(new TextEncoder().encode(stage).buffer),
  };
  const vault = {
    save: (snapshot: ArrayBuffer) => {
      saves++;
      if (saves === failSave) return Promise.reject(new Error('Storage unavailable'));
      persisted = new TextDecoder().decode(snapshot);
      return Promise.resolve();
    },
  };
  return {
    workflow: new LightDeletionWorkflow(engine, vault),
    failSave: (number: number) => {
      failSave = number;
    },
    failNetwork: (fail: boolean) => {
      reportFailure = fail;
    },
    complete: (value: boolean) => {
      complete = value;
    },
    read: () => ({ persisted, deletions, prepares, pending }),
  };
}

await test('failed intent and authorization checkpoints prevent server deletion', async () => {
  for (const failedSave of [1, 2]) {
    const state = fixture();
    state.failSave(failedSave);
    await assert.rejects(state.workflow.request(), /Storage unavailable/);
    assert.equal(state.read().deletions, 0);
    if (failedSave === 1) assert.equal(state.read().prepares, 0);
    else {
      assert.equal(state.read().persisted, 'requested');
      await state.workflow.retry();
      assert.equal(state.read().persisted, 'confirmed');
    }
  }
});

await test('unknown deletion outcomes retain durable retry authority and never report completion', async () => {
  const state = fixture();
  state.failNetwork(true);
  await assert.rejects(state.workflow.request(), /Unknown server result/);
  assert.equal(state.read().persisted, 'prepared-with-stable-token');
  assert.equal(state.read().pending, 1);
  state.failNetwork(false);
  const view = await state.workflow.retry();
  assert.equal(view.lightService?.pendingDeletions, 0);
  assert.equal(state.read().persisted, 'confirmed');
});

await test('partial cleanup is bounded and preserves the authorized pending operation', async () => {
  const state = fixture();
  state.complete(false);
  const view = await state.workflow.request();
  assert.equal(view.lightService?.pendingDeletions, 1);
  assert.ok(state.read().deletions > 0 && state.read().deletions <= 16);
  assert.equal(state.read().persisted, 'prepared-with-stable-token');
});

await test('failed completion persistence keeps the previous retry authorization recoverable', async () => {
  const state = fixture();
  state.failSave(3);
  await assert.rejects(state.workflow.request(), /Storage unavailable/);
  assert.equal(state.read().deletions, 1);
  assert.equal(state.read().persisted, 'prepared-with-stable-token');
});
