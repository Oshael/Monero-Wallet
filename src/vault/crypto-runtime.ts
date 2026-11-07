import type { WorkerResult } from '../runtime/worker-host.ts';
import { VaultCipher } from './cipher.ts';
import { VaultError } from './errors.ts';
import type { CryptoCommand, CryptoReply } from './messages.ts';

export class CryptoRuntime {
  #cipher: VaultCipher | undefined;
  #rotation: VaultCipher | undefined;

  async execute(command: CryptoCommand): Promise<WorkerResult<CryptoReply>> {
    switch (command.kind) {
      case 'create':
        this.#assertClosed();
        this.#cipher = await VaultCipher.create(command.password);
        return { value: { kind: 'ready' } };
      case 'open':
        return this.#open(command);
      case 'seal':
        return this.#seal(this.#active(), command.plaintext);
      case 'verify': {
        const plaintext = await this.#active().decrypt(command.envelope);
        new Uint8Array(plaintext).fill(0);
        return { value: { kind: 'ready' } };
      }
      case 'verify-password':
        await this.#verifyPassword(command.envelope, command.password);
        return { value: { kind: 'ready' } };
      case 'prepare-password':
        await this.#preparePassword(command);
        return { value: { kind: 'ready' } };
      case 'seal-password':
        return this.#seal(this.#pendingPassword(), command.plaintext);
      case 'commit-password':
        this.#commitPassword();
        return { value: { kind: 'ready' } };
      case 'abort-password':
        this.#abortPassword();
        return { value: { kind: 'ready' } };
    }
  }

  destroy(): void {
    this.#cipher?.destroy();
    this.#rotation?.destroy();
    this.#cipher = undefined;
    this.#rotation = undefined;
  }

  async #open(
    command: Extract<CryptoCommand, { kind: 'open' }>,
  ): Promise<WorkerResult<CryptoReply>> {
    this.#assertClosed();
    const opened = await VaultCipher.open(command.envelope, command.password);
    this.#cipher = opened.cipher;
    return {
      value: { kind: 'plaintext', plaintext: opened.plaintext },
      transfer: [opened.plaintext],
    };
  }

  async #seal(cipher: VaultCipher, plaintext: ArrayBuffer): Promise<WorkerResult<CryptoReply>> {
    try {
      const envelope = await cipher.seal(plaintext);
      return { value: { kind: 'ciphertext', envelope }, transfer: [envelope] };
    } finally {
      new Uint8Array(plaintext).fill(0);
    }
  }

  async #preparePassword(
    command: Extract<CryptoCommand, { kind: 'prepare-password' }>,
  ): Promise<void> {
    if (this.#rotation) throw new VaultError('invalid-format');
    await this.#verifyPassword(command.envelope, command.oldPassword);
    this.#rotation = await VaultCipher.create(command.newPassword);
  }

  async #verifyPassword(envelope: ArrayBuffer, password: string): Promise<void> {
    const current = await this.#active().decrypt(envelope);
    new Uint8Array(current).fill(0);
    const verified = await VaultCipher.open(envelope, password);
    verified.cipher.destroy();
    new Uint8Array(verified.plaintext).fill(0);
  }

  #commitPassword(): void {
    if (!this.#rotation) throw new VaultError('locked');
    this.#cipher?.destroy();
    this.#cipher = this.#rotation;
    this.#rotation = undefined;
  }

  #abortPassword(): void {
    this.#rotation?.destroy();
    this.#rotation = undefined;
  }

  #active(): VaultCipher {
    if (!this.#cipher) throw new VaultError('locked');
    return this.#cipher;
  }

  #pendingPassword(): VaultCipher {
    if (!this.#rotation) throw new VaultError('locked');
    return this.#rotation;
  }

  #assertClosed(): void {
    if (this.#cipher) throw new VaultError('invalid-format');
  }
}
