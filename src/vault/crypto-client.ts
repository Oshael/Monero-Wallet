import { WorkerChannel } from '../runtime/worker-channel.ts';
import { VaultError } from './errors.ts';
import { decodeCryptoReply } from './messages.ts';
import type { CryptoCommand, CryptoReply } from './messages.ts';

export class CryptoClient {
  readonly #channel: WorkerChannel<CryptoCommand, CryptoReply>;

  constructor(signal?: AbortSignal) {
    const worker = new Worker(new URL('vault.worker.js', import.meta.url), { type: 'module' });
    this.#channel = new WorkerChannel(worker, decodeCryptoReply, signal);
  }

  async create(password: string): Promise<void> {
    await this.#ready({ kind: 'create', password });
  }

  async open(envelope: ArrayBuffer, password: string): Promise<ArrayBuffer> {
    const reply = await this.#channel.call({ kind: 'open', envelope, password }, [envelope]);
    if (reply.kind !== 'plaintext') throw new VaultError('invalid-format');
    return reply.plaintext;
  }

  async seal(plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    return this.#sealed({ kind: 'seal', plaintext }, plaintext);
  }

  async verify(envelope: ArrayBuffer): Promise<void> {
    await this.#ready({ kind: 'verify', envelope }, [envelope]);
  }

  async verifyPassword(envelope: ArrayBuffer, password: string): Promise<void> {
    await this.#ready({ kind: 'verify-password', envelope, password }, [envelope]);
  }

  async preparePassword(options: {
    envelope: ArrayBuffer;
    oldPassword: string;
    newPassword: string;
  }): Promise<void> {
    await this.#ready({ kind: 'prepare-password', ...options }, [options.envelope]);
  }

  async sealPassword(plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    return this.#sealed({ kind: 'seal-password', plaintext }, plaintext);
  }

  async commitPassword(): Promise<void> {
    await this.#ready({ kind: 'commit-password' });
  }

  async abortPassword(): Promise<void> {
    await this.#ready({ kind: 'abort-password' });
  }

  close(): void {
    this.#channel.dispose();
  }

  async #sealed(command: CryptoCommand, plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    const reply = await this.#channel.call(command, [plaintext]);
    if (reply.kind !== 'ciphertext') throw new VaultError('invalid-format');
    return reply.envelope;
  }

  async #ready(command: CryptoCommand, transfer: Transferable[] = []): Promise<void> {
    const reply = await this.#channel.call(command, transfer);
    if (reply.kind !== 'ready') throw new VaultError('invalid-format');
  }
}
