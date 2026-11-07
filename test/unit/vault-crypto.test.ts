import assert from 'node:assert/strict';
import test from 'node:test';
import { VaultCipher } from '../../src/vault/cipher.ts';
import { HEADER_BYTES, parseEnvelope } from '../../src/vault/format.ts';
import { derivePasswordKey } from '../../src/vault/password-key.ts';

const password = 'correct horse fixture';
const payload = new TextEncoder().encode('Disposable sensitive wallet cache fixture.').buffer;

void test('password derivation agrees with an independent OpenSSL scrypt vector', async () => {
  const salt = new TextEncoder().encode('0123456789abcdef');
  const actual = await derivePasswordKey(password, salt);
  const rawExpected = Uint8Array.from(
    Buffer.from('396aaf7eab663c882755535ee338b617bab4d41c8b9ff40be2a4ac9dd0a66ca4', 'hex'),
  );
  const expected = await crypto.subtle.importKey('raw', rawExpected, 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  const options = { name: 'AES-GCM', iv, tagLength: 128 };
  assert.deepEqual(
    await crypto.subtle.encrypt(options, actual, payload),
    await crypto.subtle.encrypt(options, expected, payload),
  );
  assert.equal(actual.extractable, false);
});

void test('encrypted snapshots reopen and each checkpoint gets a fresh nonce', async () => {
  const original = await VaultCipher.create(password);
  try {
    const first = await original.seal(payload);
    const second = await original.seal(payload);
    assert.notDeepEqual(parseEnvelope(first).nonce, parseEnvelope(second).nonce);
    const opened = await VaultCipher.open(first, password);
    try {
      assert.deepEqual(opened.plaintext, payload);
      assert.deepEqual(await opened.cipher.decrypt(second), payload);
    } finally {
      opened.cipher.destroy();
      new Uint8Array(opened.plaintext).fill(0);
    }
    await assert.rejects(VaultCipher.open(first, 'incorrect password'), {
      code: 'authentication-failed',
    });
  } finally {
    original.destroy();
  }
});

void test('tampered headers, ciphertext and tags never return a plaintext snapshot', async () => {
  const cipher = await VaultCipher.create(password);
  try {
    const sealed = await cipher.seal(payload);
    for (const offset of [24, 40, HEADER_BYTES, sealed.byteLength - 1]) {
      const changed = new Uint8Array(sealed.slice(0));
      changed[offset] = (changed[offset] ?? 0) ^ 1;
      await assert.rejects(cipher.decrypt(changed.buffer), { code: 'authentication-failed' });
    }
  } finally {
    cipher.destroy();
  }
});

void test('unsupported work factors and truncated backups fail at the format boundary', async () => {
  const cipher = await VaultCipher.create(password);
  try {
    const sealed = await cipher.seal(payload);
    for (const offset of [8, 10, 12, 16, 20]) {
      const changed = new Uint8Array(sealed.slice(0));
      changed[offset] = (changed[offset] ?? 0) ^ 1;
      assert.throws(() => parseEnvelope(changed.buffer), { code: 'unsupported-format' });
    }
    assert.throws(() => parseEnvelope(sealed.slice(0, HEADER_BYTES)), { code: 'invalid-format' });
  } finally {
    cipher.destroy();
  }
});

void test('destroyed cipher handles cannot unlock or create snapshots', async () => {
  const cipher = await VaultCipher.create(password);
  const sealed = await cipher.seal(payload);
  cipher.destroy();
  await assert.rejects(cipher.decrypt(sealed), { code: 'locked' });
  await assert.rejects(cipher.seal(payload), { code: 'locked' });
});

void test('invalid password inputs fail before password derivation', async () => {
  await assert.rejects(VaultCipher.create('short'), { code: 'password-invalid' });
  await assert.rejects(derivePasswordKey('x'.repeat(1025), new Uint8Array(16)), {
    code: 'password-invalid',
  });
});
