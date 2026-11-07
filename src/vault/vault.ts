import { CryptoClient } from './crypto-client.ts';
import { VaultError } from './errors.ts';
import { VaultStorage } from './storage.ts';
import type { StoredVault } from './storage.ts';

export interface VaultOptions {
  storage?: VaultStorage;
  signal?: AbortSignal;
}

export interface OpenedVault {
  vault: Vault;
  snapshot: ArrayBuffer;
}

export class Vault {
  readonly #storage: VaultStorage;
  readonly #crypto: CryptoClient;
  readonly #signal: AbortSignal | undefined;
  #revision: string | undefined;
  #closed = false;

  private constructor(storage: VaultStorage, client: CryptoClient, signal?: AbortSignal) {
    this.#storage = storage;
    this.#crypto = client;
    this.#signal = signal;
  }

  static async exists(storage = new VaultStorage()): Promise<boolean> {
    return Boolean((await storage.read()) ?? (await storage.read('previous')));
  }

  static async create(password: string, options: VaultOptions = {}): Promise<Vault> {
    const storage = options.storage ?? new VaultStorage();
    if (await Vault.exists(storage)) throw new VaultError('revision-conflict');
    const client = new CryptoClient(options.signal);
    try {
      await client.create(password);
      return new Vault(storage, client, options.signal);
    } catch (error) {
      client.close();
      throw error;
    }
  }

  static async open(password: string, options: VaultOptions = {}): Promise<OpenedVault> {
    return Vault.#openStored(password, 'active', options);
  }

  static async recoverPrevious(password: string, options: VaultOptions = {}): Promise<OpenedVault> {
    return Vault.#openStored(password, 'previous', options);
  }

  static async importBackup(
    envelope: ArrayBuffer,
    password: string,
    options: VaultOptions = {},
  ): Promise<OpenedVault> {
    const storage = options.storage ?? new VaultStorage();
    const active = await storage.read();
    return Vault.#openEnvelope({ envelope, revision: active?.revision }, password, {
      ...options,
      storage,
    });
  }

  static async #openStored(
    password: string,
    key: 'active' | 'previous',
    options: VaultOptions,
  ): Promise<OpenedVault> {
    const storage = options.storage ?? new VaultStorage();
    const active = await storage.read();
    const selected = key === 'active' ? active : await storage.read('previous');
    if (!selected) throw new VaultError('storage-failed');
    return Vault.#openEnvelope(
      { envelope: selected.envelope, revision: active?.revision },
      password,
      {
        ...options,
        storage,
      },
    );
  }

  static async #openEnvelope(
    record: { envelope: ArrayBuffer; revision: string | undefined },
    password: string,
    options: VaultOptions & { storage: VaultStorage },
  ): Promise<OpenedVault> {
    const client = new CryptoClient(options.signal);
    let snapshot: ArrayBuffer | undefined;
    try {
      snapshot = await client.open(record.envelope, password);
      const vault = new Vault(options.storage, client, options.signal);
      vault.#revision = record.revision;
      vault.#assertOpen();
      return { vault, snapshot };
    } catch (error) {
      if (snapshot) wipeRemaining(snapshot);
      client.close();
      throw error;
    }
  }

  async save(snapshot: ArrayBuffer): Promise<void> {
    try {
      this.#assertOpen();
      const envelope = await this.#crypto.seal(snapshot);
      this.#assertOpen();
      const saved = await this.#storage.write(envelope, this.#revision);
      this.#revision = saved.revision;
    } finally {
      wipeRemaining(snapshot);
    }
  }

  async exportBackup(): Promise<ArrayBuffer> {
    const current = await this.#current();
    await this.#crypto.verify(current.envelope.slice(0));
    this.#assertOpen();
    return current.envelope;
  }

  async verifyPassword(password: string): Promise<void> {
    const current = await this.#current();
    await this.#crypto.verifyPassword(current.envelope, password);
    this.#assertOpen();
  }

  async changePassword(options: {
    oldPassword: string;
    newPassword: string;
    snapshot: ArrayBuffer;
  }): Promise<void> {
    try {
      await this.#changePassword(options);
    } finally {
      wipeRemaining(options.snapshot);
    }
  }

  async #changePassword(options: {
    oldPassword: string;
    newPassword: string;
    snapshot: ArrayBuffer;
  }): Promise<void> {
    const current = await this.#current();
    await this.#crypto.preparePassword({
      envelope: current.envelope,
      oldPassword: options.oldPassword,
      newPassword: options.newPassword,
    });
    let saved = false;
    try {
      const envelope = await this.#crypto.sealPassword(options.snapshot);
      this.#assertOpen();
      const next = await this.#storage.replaceKey(envelope, current.revision);
      this.#revision = next.revision;
      saved = true;
      await this.#crypto.commitPassword();
    } catch (error) {
      if (saved) {
        this.close();
        throw new VaultError('password-changed-locked');
      }
      await this.#crypto.abortPassword();
      throw error;
    }
  }

  close(): void {
    this.#closed = true;
    this.#crypto.close();
  }

  async #current(): Promise<StoredVault> {
    this.#assertOpen();
    const current = await this.#storage.read();
    this.#assertOpen();
    if (!current || current.revision !== this.#revision) throw new VaultError('revision-conflict');
    return current;
  }

  #assertOpen(): void {
    if (this.#closed || this.#signal?.aborted) throw new VaultError('locked');
  }
}

function wipeRemaining(buffer: ArrayBuffer): void {
  if (buffer.byteLength > 0) new Uint8Array(buffer).fill(0);
}
