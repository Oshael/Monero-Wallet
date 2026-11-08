import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { LightWalletRegistration } from '../../src/engine/light-wallet/registration.ts';
import { LightWalletSync } from '../../src/engine/light-wallet/sync.ts';
import { NativeWalletState } from '../../src/engine/wallet-state.ts';

function makeLightSync(
  wallet: ConstructorParameters<typeof LightWalletSync>[0],
  state: NativeWalletState,
  options: Omit<ConstructorParameters<typeof LightWalletSync>[2], 'registration'>,
): LightWalletSync {
  return new LightWalletSync(wallet, state, {
    ...options,
    registration: new LightWalletRegistration(wallet, options.network, options.settings),
  });
}

async function settled(state: NativeWalletState): Promise<void> {
  for (let attempt = 0; attempt < 100 && state.status === 'syncing'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.notEqual(state.status, 'syncing');
}

function scannerReplies(scanned: number): Record<string, unknown> {
  return {
    get_version: { network_type: 'stage', max_subaddresses: 2000 },
    login: { new_address: false, generated_locally: true },
    import_wallet_request: {
      import_fee: '0',
      new_request: false,
      request_fulfilled: true,
      lookahead: { maj_i: 1, min_i: 1000 },
    },
    get_address_info: { scanned_block_height: scanned, blockchain_height: 200 },
    get_address_txs: { scanned_block_height: scanned, blockchain_height: 200 },
    get_unspent_outs: {},
  };
}

function scannerFetch(responses: Record<string, unknown>) {
  return (uri: RequestInfo | URL) => {
    assert.ok(typeof uri === 'string');
    return Promise.resolve(Response.json(responses[new URL(uri).pathname.slice(1)]));
  };
}

await test('behind scanners expose server progress without importing or advancing the recovery checkpoint', async () => {
  const responses = scannerReplies(100);
  const fetch = mock.method(globalThis, 'fetch', scannerFetch(responses));
  const node = () => Promise.resolve({ height: 201, targetHeight: 0, synced: true });
  const state = await NativeWalletState.create(
    {
      getHeight: () => Promise.resolve(1),
      getBalance: () => Promise.resolve(7n),
      getUnlockedBalance: () => Promise.resolve(5n),
    },
    node,
  );
  const imports = mock.fn(async () => {
    await Promise.resolve();
  });
  const sync = makeLightSync(
    {
      getPrimaryAddress: () => Promise.resolve('disposable'),
      getPrivateViewKey: () => Promise.resolve('12'.repeat(32)),
      importLightWalletData: imports,
    },
    state,
    {
      network: 'stagenet',
      restoreHeight: 0,
      readNode: node,
      settings: { uri: 'https://scanner.example', height: 0, adoptLegacy: true },
    },
  );
  try {
    sync.start();
    await settled(state);
    assert.equal(state.status, 'waiting-scanner');
    assert.equal(state.view().height, 101);
    assert.equal(state.view().targetHeight, 201);
    assert.equal(state.view().balance, '7');
    assert.equal(imports.mock.callCount(), 0);
    assert.equal(sync.checkpoint().height, 0);
    assert.equal(sync.checkpoint().adoptLegacy, true);
  } finally {
    await sync.stop();
    fetch.mock.restore();
  }
});

await test('native import failures cannot advance the light checkpoint and fatal failures remain observable', async () => {
  for (const failure of [
    new Error('Rejected data'),
    new WebAssembly.RuntimeError('Fatal fixture'),
  ]) {
    const responses = scannerReplies(200);
    const fetch = mock.method(globalThis, 'fetch', scannerFetch(responses));
    const node = () => Promise.resolve({ height: 201, targetHeight: 0, synced: true });
    const state = await NativeWalletState.create(
      {
        getHeight: () => Promise.resolve(1),
        getBalance: () => Promise.resolve(0n),
        getUnlockedBalance: () => Promise.resolve(0n),
      },
      node,
    );
    const sync = makeLightSync(
      {
        getPrimaryAddress: () => Promise.resolve('disposable'),
        getPrivateViewKey: () => Promise.resolve('12'.repeat(32)),
        importLightWalletData: () => Promise.reject(failure),
      },
      state,
      {
        network: 'stagenet',
        restoreHeight: 0,
        readNode: node,
        settings: { uri: 'https://scanner.example', height: 0, adoptLegacy: true },
      },
    );
    try {
      sync.start();
      await settled(state);
      assert.equal(state.status, 'failed');
      if (failure instanceof WebAssembly.RuntimeError) {
        assert.throws(() => {
          sync.assertHealthy();
        }, failure);
        await assert.rejects(sync.stop(), failure);
      } else {
        assert.deepEqual(sync.checkpoint(), {
          uri: 'https://scanner.example',
          height: 0,
          adoptLegacy: true,
        });
        await sync.stop();
      }
    } finally {
      fetch.mock.restore();
    }
  }
});

await test('a successful native import publishes the matching checkpoint before a later node failure', async () => {
  const responses = scannerReplies(200);
  const fetch = mock.method(globalThis, 'fetch', scannerFetch(responses));
  let imported = false;
  const node = () =>
    imported
      ? Promise.reject(new Error('Node stopped after native import'))
      : Promise.resolve({ height: 201, targetHeight: 0, synced: true });
  const state = await NativeWalletState.create(
    {
      getHeight: () => Promise.resolve(imported ? 201 : 1),
      getBalance: () => Promise.resolve(0n),
      getUnlockedBalance: () => Promise.resolve(0n),
    },
    node,
  );
  const sync = makeLightSync(
    {
      getPrimaryAddress: () => Promise.resolve('disposable'),
      getPrivateViewKey: () => Promise.resolve('12'.repeat(32)),
      importLightWalletData: () => {
        imported = true;
        return Promise.resolve();
      },
    },
    state,
    {
      network: 'stagenet',
      restoreHeight: 0,
      readNode: node,
      settings: { uri: 'https://scanner.example', height: 0, adoptLegacy: true },
    },
  );
  try {
    sync.start();
    await settled(state);
    assert.equal(state.status, 'failed');
    assert.deepEqual(sync.checkpoint(), {
      uri: 'https://scanner.example',
      height: 201,
      adoptLegacy: false,
    });
  } finally {
    await sync.stop();
    fetch.mock.restore();
  }
});

await test('restored deletion requests block registration without advancing the native checkpoint', async () => {
  const wallet = {
    getPrimaryAddress: () => Promise.resolve('disposable'),
    getPrivateViewKey: () => Promise.resolve('12'.repeat(32)),
    importLightWalletData: mock.fn(() => Promise.resolve()),
  };
  const node = () => Promise.resolve({ height: 201, targetHeight: 0, synced: true });
  const state = await NativeWalletState.create(
    {
      getHeight: () => Promise.resolve(100),
      getBalance: () => Promise.resolve(7n),
      getUnlockedBalance: () => Promise.resolve(5n),
    },
    node,
  );
  const registration = new LightWalletRegistration(wallet, 'stagenet', {
    uri: 'https://scanner.example',
  });
  registration.requestDeletion();
  const settings = { ...registration.checkpoint(), height: 100, adoptLegacy: false };
  const restored = new LightWalletRegistration(wallet, 'stagenet', settings);
  const sync = new LightWalletSync(wallet, state, {
    network: 'stagenet',
    restoreHeight: 0,
    readNode: node,
    settings,
    registration: restored,
  });
  const fetch = mock.method(globalThis, 'fetch', () =>
    Promise.reject(new Error('Unexpected registration')),
  );
  try {
    assert.throws(() => {
      sync.start();
    }, /light-registration-disabled/);
    assert.equal(sync.checkpoint().height, 100);
    assert.equal(state.view().balance, '7');
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(wallet.importLightWalletData.mock.callCount(), 0);
  } finally {
    await sync.stop();
    fetch.mock.restore();
  }
});
