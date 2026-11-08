import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { LightWalletRegistration } from '../../src/engine/light-wallet/registration.ts';
import { LightWalletDeletionClient } from '../../src/engine/light-wallet/deletion-client.ts';
import { registrationSettings } from '../../src/engine/light-wallet/registration-settings.ts';
import { object } from '../../src/domain/validation.ts';
import { MAXIMUM_SCANNER_DELETIONS } from '../../src/domain/light-service.ts';

const viewKey = '12'.repeat(32);
const wallet = {
  getPrimaryAddress: () => Promise.resolve('disposable-address'),
  getPrivateViewKey: () => Promise.resolve(viewKey),
};
const uri = 'https://scanner.example';
const token = 'ab'.repeat(32);

function registration(): LightWalletRegistration {
  return new LightWalletRegistration(wallet, 'stagenet', { uri });
}

await test('deletion persists a disabled registration and retries the same token without logging in', async () => {
  const posts: { method: string; body: Record<string, unknown> }[] = [];
  let complete: unknown = false;
  const fetch = mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const method = new URL(requestUrl(input)).pathname.slice(1);
    if (method === 'get_version') return Promise.resolve(Response.json({ network_type: 'stage' }));
    assert.ok(method === 'prepare_account_delete' || method === 'delete_account');
    const encoded = init?.body;
    assert.ok(typeof encoded === 'string');
    const body = object(JSON.parse(encoded) as unknown);
    posts.push({ method, body });
    assert.equal(body.view_key, viewKey);
    assert.equal(body.address, 'disposable-address');
    return Promise.resolve(
      Response.json(method === 'prepare_account_delete' ? { token } : { complete }),
    );
  });
  try {
    let owner = registration();
    owner.requestDeletion();
    assert.equal(posts.length, 0);
    assert.throws(() => owner.syncUri(), /light-registration-disabled/);
    const requested = owner.checkpoint();
    owner = new LightWalletRegistration(wallet, 'stagenet', requested);
    assert.throws(() => owner.syncUri(), /light-registration-disabled/);
    await owner.prepareNext();
    const prepared = owner.checkpoint();
    assert.equal(prepared.registration?.pending[0]?.token, token);
    owner = new LightWalletRegistration(wallet, 'stagenet', prepared);
    await owner.prepareNext();
    assert.equal(posts.filter((entry) => entry.method === 'prepare_account_delete').length, 1);
    await owner.finishNext();
    assert.equal(owner.view().pendingDeletions, 1);
    complete = 'true';
    await assert.rejects(owner.finishNext());
    assert.equal(owner.view().pendingDeletions, 1);
    complete = true;
    await owner.finishNext();
    assert.equal(owner.view().phase, 'deleted');
    assert.equal(owner.view().pendingDeletions, 0);
    assert.throws(() => owner.syncUri(), /light-registration-disabled/);
    for (const entry of posts) {
      assert.deepEqual(
        Object.keys(entry.body).sort(),
        entry.method === 'prepare_account_delete'
          ? ['address', 'view_key']
          : ['address', 'token', 'view_key'],
      );
      if (entry.method === 'delete_account') assert.equal(entry.body.token, token);
    }
    owner.select(uri);
    assert.equal(owner.syncUri(), uri);
  } finally {
    fetch.mock.restore();
  }
});

await test('a changed network prevents deletion credential upload and a stopped server preserves the intent', async () => {
  const methods: string[] = [];
  let network = 'main';
  const fetch = mock.method(globalThis, 'fetch', (input: RequestInfo | URL) => {
    const method = new URL(requestUrl(input)).pathname.slice(1);
    methods.push(method);
    if (method === 'get_version') return Promise.resolve(Response.json({ network_type: network }));
    return Promise.reject(new Error('Server stopped'));
  });
  try {
    const owner = registration();
    owner.requestDeletion();
    const before = owner.checkpoint();
    await assert.rejects(owner.prepareNext(), /wrong-light-network/);
    assert.deepEqual(methods, ['get_version']);
    assert.deepEqual(owner.checkpoint(), before);
    network = 'stage';
    await assert.rejects(owner.prepareNext(), /light-server-unavailable/);
    assert.deepEqual(owner.checkpoint(), before);
  } finally {
    fetch.mock.restore();
  }
});

await test('changing scanners keeps older deletions and their completion cannot disable a new selection', async () => {
  const calls: string[] = [];
  const fetch = mock.method(globalThis, 'fetch', (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    calls.push(url.hostname + url.pathname);
    if (url.pathname === '/get_version')
      return Promise.resolve(Response.json({ network_type: 'stage' }));
    return Promise.resolve(
      Response.json(url.pathname === '/prepare_account_delete' ? { token } : { complete: true }),
    );
  });
  try {
    const owner = registration();
    owner.requestDeletion();
    await owner.prepareNext();
    assert.throws(() => {
      owner.select(uri);
    }, /scanner-deletion-pending/);
    owner.select('https://second.example');
    assert.equal(owner.syncUri(), 'https://second.example');
    owner.requestDeletion();
    await owner.prepareNext();
    assert.equal(owner.view().pendingDeletions, 2);
    assert.deepEqual(owner.view().deletionOrigins, [uri, 'https://second.example']);
    await owner.finishNext();
    assert.equal(owner.view().phase, 'deleted');
    assert.equal(owner.view().pendingDeletions, 1);
    owner.select('https://second.example');
    await owner.finishNext();
    assert.equal(owner.syncUri(), 'https://second.example');
    assert.equal(owner.view().pendingDeletions, 0);
    assert.ok(calls.includes('scanner.example/delete_account'));
    assert.ok(calls.includes('second.example/delete_account'));
  } finally {
    fetch.mock.restore();
  }
});

await test('pending deletion capacity rejects new work without dropping accepted intents', () => {
  const owner = registration();
  for (let index = 0; index < MAXIMUM_SCANNER_DELETIONS; index++) {
    owner.select(`https://scanner-${String(index)}.example`);
    owner.requestDeletion();
  }
  owner.select(uri);
  const full = owner.checkpoint();
  assert.throws(() => {
    owner.requestDeletion();
  }, /too-many-scanner-deletions/);
  assert.deepEqual(owner.checkpoint(), full);
  const valid = full.registration;
  assert.ok(valid);
  assert.throws(() =>
    registrationSettings({ ...valid, pending: [...valid.pending, valid.pending[0]] }, uri),
  );
  assert.throws(() =>
    registrationSettings({ ...valid, phase: 'deleting', current: crypto.randomUUID() }, uri),
  );
  const duplicate = { ...valid, pending: [valid.pending[0], valid.pending[0]] };
  assert.throws(() => registrationSettings(duplicate, uri));
});

await test('a disposed deletion client cannot send credentials', async () => {
  const fetch = mock.method(globalThis, 'fetch', () =>
    Promise.reject(new Error('Unexpected egress')),
  );
  try {
    const client = new LightWalletDeletionClient({
      uri,
      network: 'stagenet',
      credentials: { address: 'disposable', view_key: viewKey },
    });
    client.dispose();
    await assert.rejects(client.finish(token), /light-client-closed/);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    fetch.mock.restore();
  }
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
