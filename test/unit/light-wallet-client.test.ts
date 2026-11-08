import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { LightWalletClient } from '../../src/engine/light-wallet/client.ts';

const options = {
  uri: 'https://scanner.example',
  network: 'stagenet' as const,
  restoreHeight: 123,
  credentials: { address: 'disposable', view_key: '12'.repeat(32) },
};

function replies(): Record<string, unknown>[] {
  return [
    { network_type: 'stage', max_subaddresses: 2000 },
    { new_address: true, generated_locally: true },
    {
      import_fee: '0',
      new_request: true,
      request_fulfilled: true,
      lookahead: { maj_i: 1, min_i: 1000 },
    },
  ];
}

await test('wrong-network scanners cannot receive a private view key', async () => {
  const fetch = mock.method(globalThis, 'fetch', () =>
    Promise.resolve(Response.json({ network_type: 'main', max_subaddresses: 2000 })),
  );
  try {
    await assert.rejects(LightWalletClient.open(options), /wrong-light-network/);
    assert.equal(fetch.mock.callCount(), 1);
  } finally {
    fetch.mock.restore();
  }
});

await test('light registration rejects new fees, pending admission and missing subaddress coverage', async () => {
  const cases = [
    { changes: { import_fee: '1' }, code: /light-import-fee-unsupported/ },
    { changes: { request_fulfilled: false }, code: /light-import-awaiting-approval/ },
    { changes: { lookahead: { maj_i: 1, min_i: 20 } }, code: /light-subaddresses-unavailable/ },
  ];
  for (const scenario of cases) {
    const responses = replies();
    responses[2] = { ...responses[2], ...scenario.changes };
    const fetch = mock.method(globalThis, 'fetch', () =>
      Promise.resolve(Response.json(responses.shift())),
    );
    try {
      await assert.rejects(LightWalletClient.open(options), scenario.code);
    } finally {
      fetch.mock.restore();
    }
  }
});

await test('registration preserves the original birthday and disposed clients cannot send credentials', async () => {
  const responses = replies();
  const bodies: unknown[] = [];
  const fetch = mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init: RequestInit) => {
    bodies.push(init.body);
    return Promise.resolve(Response.json(responses.shift()));
  });
  let client: LightWalletClient | undefined;
  try {
    client = await LightWalletClient.open(options);
    assert.equal(bodies[0], undefined);
    assert.equal(
      bodies[2],
      JSON.stringify({
        ...options.credentials,
        from_height: 123,
        lookahead: { maj_i: 1, min_i: 1000 },
      }),
    );
    client.dispose();
    await assert.rejects(
      client.read(() => Promise.resolve({ height: 124, targetHeight: 0, synced: true })),
      /light-client-closed/,
    );
    assert.equal(fetch.mock.callCount(), 3);
  } finally {
    client?.dispose();
    fetch.mock.restore();
  }
});

await test('stopping a scan aborts registration before its client is returned', async () => {
  const stop = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const fetch = mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init: RequestInit) => {
    requestSignal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener(
        'abort',
        () => {
          reject(new Error('Stopped'));
        },
        { once: true },
      );
    });
  });
  try {
    const opening = LightWalletClient.open({ ...options, signal: stop.signal });
    stop.abort();
    await assert.rejects(opening, /light-server-unavailable/);
    assert.equal(requestSignal?.aborted, true);
    assert.equal(fetch.mock.callCount(), 1);
  } finally {
    stop.abort();
    fetch.mock.restore();
  }
});

await test('scanner capacity must cover the supported address range and its lookahead', async () => {
  const fetch = mock.method(globalThis, 'fetch', () =>
    Promise.resolve(Response.json({ network_type: 'stage', max_subaddresses: 1999 })),
  );
  try {
    await assert.rejects(LightWalletClient.open(options), /light-subaddresses-unavailable/);
    assert.equal(fetch.mock.callCount(), 1);
  } finally {
    fetch.mock.restore();
  }
});
