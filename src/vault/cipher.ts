import { VaultError } from './errors.ts';
import { createHeader, MAX_PAYLOAD_BYTES, parseEnvelope } from './format.ts';
import { derivePasswordKey, validateNewPassword } from './password-key.ts';

export class VaultCipher {
  #key: CryptoKey | undefined;
  readonly #salt: Uint8Array<ArrayBuffer>;

  private constructor(key: CryptoKey, salt: Uint8Array<ArrayBuffer>) {
    this.#key = key;
    this.#salt = salt;
  }

  static async create(password: string): Promise<VaultCipher> {
    validateNewPassword(password);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return new VaultCipher(await derivePasswordKey(password, salt), salt);
  }

  static async open(
    envelope: ArrayBuffer,
    password: string,
  ): Promise<{ cipher: VaultCipher; plaintext: ArrayBuffer }> {
    const { salt } = parseEnvelope(envelope);
    const cipher = new VaultCipher(await derivePasswordKey(password, salt), salt);
    try {
      return { cipher, plaintext: await cipher.decrypt(envelope) };
    } catch (error) {
      cipher.destroy();
      throw error;
    }
  }

  async seal(plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    if (plaintext.byteLength > MAX_PAYLOAD_BYTES) throw new VaultError('too-large');
    const key = this.#requireKey();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const header = createHeader(this.#salt, nonce);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: header, tagLength: 128 },
      key,
      plaintext,
    );
    const result = new Uint8Array(header.byteLength + ciphertext.byteLength);
    result.set(header);
    result.set(new Uint8Array(ciphertext), header.byteLength);
    return result.buffer;
  }

  async decrypt(envelope: ArrayBuffer): Promise<ArrayBuffer> {
    const key = this.#requireKey();
    const parsed = parseEnvelope(envelope);
    if (!parsed.salt.every((value, index) => value === this.#salt[index])) {
      throw new VaultError('authentication-failed');
    }
    try {
      return await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: parsed.nonce,
          additionalData: parsed.header,
          tagLength: 128,
        },
        key,
        parsed.ciphertext,
      );
    } catch {
      throw new VaultError('authentication-failed');
    }
  }

  destroy(): void {
    this.#key = undefined;
    this.#salt.fill(0);
  }

  #requireKey(): CryptoKey {
    if (!this.#key) throw new VaultError('locked');
    return this.#key;
  }
}
