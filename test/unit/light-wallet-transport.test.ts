import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { LightWalletTransport } from '../../src/engine/light-wallet/transport.ts';

await test('view-key transport rejects unencrypted non-loopback destinations', () => {
  assert.throws(() => new LightWalletTransport('http://scanner.example'), /node-requires-https/);
  assert.throws(
    () => new LightWalletTransport('https://scanner.example/?view_key=secret'),
    /invalid-node/,
  );
});

await test('view-key requests cannot follow redirects or reuse ambient cookies', async () => {
  const requests: RequestInit[] = [];
  const fetch = mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init: RequestInit) => {
    requests.push(init);
    return Promise.resolve(new Response('{"new_address":true}'));
  });
  const client = new LightWalletTransport('https://scanner.example');
  try {
    await client.request('login', { address: 'disposable', view_key: 'disposable' });
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.signal?.aborted, true);
  } finally {
    client.dispose();
    fetch.mock.restore();
  }
});

await test('oversized scanner responses are rejected and their request is aborted', async () => {
  let signal: AbortSignal | null | undefined;
  const fetch = mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init: RequestInit) => {
    signal = init.signal;
    return Promise.resolve(
      new Response('{}', { headers: { 'Content-Length': String(65 * 1024 * 1024) } }),
    );
  });
  const client = new LightWalletTransport('https://scanner.example');
  try {
    await assert.rejects(client.request('get_version'), /light-response-too-large/);
    assert.equal(signal?.aborted, true);
    client.dispose();
    await assert.rejects(client.request('get_version'), /light-client-closed/);
  } finally {
    client.dispose();
    fetch.mock.restore();
  }
});
