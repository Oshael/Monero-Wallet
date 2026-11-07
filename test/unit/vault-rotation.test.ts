import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { CryptoRuntime } from '../../src/vault/crypto-runtime.ts';
import { VaultStorage } from '../../src/vault/storage.ts';

const oldPassword = 'original fixture password';
const newPassword = 'replacement fixture password';

function snapshot(): ArrayBuffer {
  return new TextEncoder().encode('Disposable complete wallet state.').buffer;
}

async function seal(runtime: CryptoRuntime, kind: 'seal' | 'seal-password'): Promise<ArrayBuffer> {
  const result = await runtime.execute({ kind, plaintext: snapshot() });
  assert.ok(result.value.kind === 'ciphertext');
  return result.value.envelope;
}

void test('aborting a password change preserves the current encryption context', async () => {
  const runtime = new CryptoRuntime();
  try {
    await runtime.execute({ kind: 'create', password: oldPassword });
    const original = await seal(runtime, 'seal');
    await runtime.execute({
      kind: 'prepare-password',
      oldPassword,
      newPassword,
      envelope: original,
    });
    const replacement = await seal(runtime, 'seal-password');
    await runtime.execute({ kind: 'abort-password' });
    await runtime.execute({ kind: 'verify', envelope: original });
    await assert.rejects(runtime.execute({ kind: 'verify', envelope: replacement }), {
      code: 'authentication-failed',
    });
  } finally {
    runtime.destroy();
  }
});

void test('password rotation atomically replaces both retained local records', async () => {
  const runtime = new CryptoRuntime();
  const storage = new VaultStorage({ factory: new IDBFactory(), name: crypto.randomUUID() });
  try {
    await runtime.execute({ kind: 'create', password: oldPassword });
    const original = await seal(runtime, 'seal');
    const saved = await storage.write(original);
    await runtime.execute({
      kind: 'prepare-password',
      oldPassword,
      newPassword,
      envelope: original,
    });
    const replacement = await seal(runtime, 'seal-password');
    await storage.replaceKey(replacement, saved.revision);
    await runtime.execute({ kind: 'commit-password' });
    const active = await storage.read();
    const previous = await storage.read('previous');
    assert.ok(active && previous);
    await runtime.execute({
      kind: 'verify-password',
      password: newPassword,
      envelope: active.envelope,
    });
    await runtime.execute({
      kind: 'verify-password',
      password: newPassword,
      envelope: previous.envelope,
    });
    await assert.rejects(
      runtime.execute({
        kind: 'verify-password',
        password: oldPassword,
        envelope: active.envelope,
      }),
      { code: 'authentication-failed' },
    );
  } finally {
    runtime.destroy();
  }
});

void test('wrong current password cannot replace the active key', async () => {
  const runtime = new CryptoRuntime();
  try {
    await runtime.execute({ kind: 'create', password: oldPassword });
    const original = await seal(runtime, 'seal');
    await assert.rejects(
      runtime.execute({
        kind: 'prepare-password',
        oldPassword: 'incorrect fixture password',
        newPassword,
        envelope: original,
      }),
      { code: 'authentication-failed' },
    );
    await runtime.execute({ kind: 'verify', envelope: original });
    await assert.rejects(runtime.execute({ kind: 'seal-password', plaintext: snapshot() }), {
      code: 'locked',
    });
  } finally {
    runtime.destroy();
  }
});
