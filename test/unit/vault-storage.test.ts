import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { VaultStorage } from '../../src/vault/storage.ts';

function storage(): VaultStorage {
  return new VaultStorage({ factory: new IDBFactory(), name: crypto.randomUUID() });
}

function ciphertext(value: number): ArrayBuffer {
  return Uint8Array.of(value, 0xff, 0x80).buffer;
}

void test('a new wallet cannot overwrite an existing encrypted record', async () => {
  const vault = storage();
  assert.equal(await vault.read(), undefined);
  const initial = await vault.write(ciphertext(1));
  await assert.rejects(vault.write(ciphertext(2)), { code: 'revision-conflict' });
  assert.deepEqual(await vault.read(), initial);
});

void test('a committed checkpoint retains exactly the prior encrypted record', async () => {
  const vault = storage();
  const initial = await vault.write(ciphertext(1));
  const second = await vault.write(ciphertext(2), initial.revision);
  const third = await vault.write(ciphertext(3), second.revision);
  assert.deepEqual(await vault.read(), third);
  assert.deepEqual(await vault.read('previous'), second);
});

void test('concurrent writers cannot both commit from the same revision', async () => {
  const vault = storage();
  const initial = await vault.write(ciphertext(1));
  const attempts = await Promise.allSettled([
    vault.write(ciphertext(2), initial.revision),
    vault.write(ciphertext(3), initial.revision),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  const reason: unknown = rejected.reason;
  assert.ok(reason instanceof Error && 'code' in reason);
  assert.equal(reason.code, 'revision-conflict');
  assert.deepEqual(await vault.read('previous'), initial);
});

void test('quota failure rolls back both the replacement and previous-record update', async () => {
  const vault = storage();
  const initial = await vault.write(ciphertext(1));
  const second = await vault.write(ciphertext(2), initial.revision);
  const originalPut: IDBObjectStore['put'] = Reflect.get(IDBObjectStore.prototype, 'put');
  IDBObjectStore.prototype.put = function (
    value: unknown,
    key?: IDBValidKey,
  ): IDBRequest<IDBValidKey> {
    if (key === 'active') throw new DOMException('Disposable quota fixture.', 'QuotaExceededError');
    return originalPut.call(this, value, key);
  };
  try {
    await assert.rejects(vault.write(ciphertext(3), second.revision), { code: 'storage-failed' });
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await vault.read(), second);
  assert.deepEqual(await vault.read('previous'), initial);
});
