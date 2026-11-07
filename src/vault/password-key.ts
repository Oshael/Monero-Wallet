import { scryptAsync } from '@noble/hashes/scrypt.js';
import { VaultError } from './errors.ts';
import { KDF } from './format.ts';

export function validateNewPassword(password: string): void {
  if (password.length > 1024) throw new VaultError('password-invalid');
  const segments = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(password);
  if (Array.from(segments).length < 12) throw new VaultError('password-invalid');
}

export async function derivePasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(password);
  let derived: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (encoded.byteLength === 0 || encoded.byteLength > 1024) {
      throw new VaultError('password-invalid');
    }
    derived = await scryptAsync(encoded, salt, {
      N: 2 ** KDF.logN,
      r: KDF.r,
      p: KDF.p,
      dkLen: 32,
      maxmem: 160 * 1024 * 1024,
      asyncTick: 10,
    });
    return await crypto.subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    encoded.fill(0);
    derived?.fill(0);
  }
}
