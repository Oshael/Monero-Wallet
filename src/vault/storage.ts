import { VaultError } from './errors.ts';
import { MAX_ENVELOPE_BYTES } from './format.ts';

export interface StoredVault {
  revision: string;
  envelope: ArrayBuffer;
}

const STORE = 'encrypted-vault';
const REVISION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function decodeRecord(value: unknown): StoredVault | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) throw new VaultError('storage-failed');
  if (!('revision' in value) || !('envelope' in value)) throw new VaultError('storage-failed');
  const { revision, envelope } = value;
  if (typeof revision !== 'string' || !REVISION.test(revision)) {
    throw new VaultError('storage-failed');
  }
  if (!(envelope instanceof ArrayBuffer) || envelope.byteLength > MAX_ENVELOPE_BYTES) {
    throw new VaultError('storage-failed');
  }
  return { revision, envelope };
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    let failed = false;
    const fail = () => {
      failed = true;
      clearTimeout(timeout);
      reject(new VaultError('storage-failed'));
    };
    const timeout = setTimeout(fail, 5000);
    request.onerror = fail;
    request.onblocked = fail;
    request.onupgradeneeded = () => {
      if (failed) {
        request.transaction?.abort();
        return;
      }
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (failed) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
  });
}

function readRecord(database: IDBDatabase, key: string): Promise<StoredVault | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key);
    let result: StoredVault | undefined;
    let failure: VaultError | undefined;
    request.onsuccess = () => {
      try {
        const stored: unknown = request.result;
        result = decodeRecord(stored);
      } catch (error) {
        failure = error instanceof VaultError ? error : new VaultError('storage-failed');
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      resolve(result);
    };
    transaction.onabort = () => {
      reject(failure ?? new VaultError('storage-failed'));
    };
  });
}

function writeRecord(
  database: IDBDatabase,
  envelopes: { active: ArrayBuffer; previous?: ArrayBuffer },
  expectedRevision: string | undefined,
): Promise<StoredVault> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore(STORE);
    const request = store.get('active');
    const next = { revision: crypto.randomUUID(), envelope: envelopes.active };
    let failure: VaultError | undefined;
    request.onsuccess = () => {
      try {
        const stored: unknown = request.result;
        const current = decodeRecord(stored);
        if (current?.revision !== expectedRevision) {
          throw new VaultError('revision-conflict');
        }
        if (envelopes.previous) {
          store.put({ revision: crypto.randomUUID(), envelope: envelopes.previous }, 'previous');
        } else if (current) {
          store.put(current, 'previous');
        }
        store.put(next, 'active');
      } catch (error) {
        failure = error instanceof VaultError ? error : new VaultError('storage-failed');
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      resolve(next);
    };
    transaction.onabort = () => {
      reject(failure ?? new VaultError('storage-failed'));
    };
  });
}

export class VaultStorage {
  readonly #factory: IDBFactory;
  readonly #name: string;

  constructor(options: { factory?: IDBFactory; name?: string } = {}) {
    this.#factory = options.factory ?? indexedDB;
    this.#name = options.name ?? 'xmr-wallet-vault';
  }

  async read(key: 'active' | 'previous' = 'active'): Promise<StoredVault | undefined> {
    const database = await openDatabase(this.#factory, this.#name);
    try {
      return await readRecord(database, key);
    } finally {
      database.close();
    }
  }

  async write(envelope: ArrayBuffer, expectedRevision?: string): Promise<StoredVault> {
    return this.#persist({ active: envelope }, expectedRevision);
  }

  async replaceKey(envelope: ArrayBuffer, expectedRevision: string): Promise<StoredVault> {
    // Both retained records must use the new password after rotation commits.
    return this.#persist({ active: envelope, previous: envelope }, expectedRevision);
  }

  async #persist(
    envelopes: { active: ArrayBuffer; previous?: ArrayBuffer },
    expectedRevision?: string,
  ): Promise<StoredVault> {
    if (expectedRevision !== undefined && !REVISION.test(expectedRevision)) {
      throw new VaultError('revision-conflict');
    }
    if (envelopes.active.byteLength > MAX_ENVELOPE_BYTES) throw new VaultError('too-large');
    if (envelopes.previous && envelopes.previous.byteLength > MAX_ENVELOPE_BYTES) {
      throw new VaultError('too-large');
    }
    const owned = { active: envelopes.active.slice(0), ...copyPrevious(envelopes.previous) };
    const database = await openDatabase(this.#factory, this.#name);
    try {
      return await writeRecord(database, owned, expectedRevision);
    } finally {
      database.close();
    }
  }
}

function copyPrevious(previous: ArrayBuffer | undefined): { previous?: ArrayBuffer } {
  return previous ? { previous: previous.slice(0) } : {};
}
