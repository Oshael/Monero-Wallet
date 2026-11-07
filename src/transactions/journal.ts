import { WalletError } from '../domain/validation.ts';
import type { PendingTransfer, TransferStatus } from './state.ts';
import { previewTransfer } from './state.ts';

export class TransferJournal {
  #pending: PendingTransfer | null;

  constructor(pending: PendingTransfer | null) {
    this.#pending = pending ? structuredClone(pending) : null;
    if (this.#pending?.status === 'broadcasting') this.#pending.status = 'unknown';
  }

  snapshot(): PendingTransfer | null {
    return this.#pending ? structuredClone(this.#pending) : null;
  }

  view(): TransferStatus | null {
    const pending = this.#pending;
    return pending
      ? { ...previewTransfer(pending), hash: pending.hash, status: pending.status }
      : null;
  }

  assertCanPrepare(): void {
    if (this.#pending && this.#pending.status !== 'confirmed')
      throw new WalletError('pending-transfer');
  }

  prepared(pending: PendingTransfer): void {
    this.assertCanPrepare();
    if (pending.status !== 'prepared' || pending.signedHex || pending.hash)
      throw new WalletError('invalid-transfer-state');
    this.#pending = structuredClone(pending);
  }

  require(id: string, states: PendingTransfer['status'][]): PendingTransfer {
    const pending = this.#pending;
    if (pending?.intent.id !== id) throw new WalletError('approval-mismatch');
    if (!states.includes(pending.status)) throw new WalletError('invalid-transfer-state');
    return structuredClone(pending);
  }

  signed(id: string, signed: { signedHex: string; hash: string }): void {
    const pending = this.require(id, ['prepared']);
    this.#pending = { ...pending, ...signed, unsignedHex: '', status: 'signed' };
  }

  arm(id: string): void {
    // A failed pre-broadcast checkpoint can leave this in memory. Retrying must
    // reuse the same signed bytes, just as recovery from an uncertain response.
    const pending = this.require(id, ['signed', 'broadcasting', 'unknown']);
    this.#pending = { ...pending, status: 'broadcasting' };
  }

  broadcastResult(id: string, accepted: boolean): void {
    const pending = this.require(id, ['broadcasting']);
    this.#pending = { ...pending, status: accepted ? 'relayed' : 'unknown' };
  }

  observed(id: string, confirmed: boolean): void {
    const pending = this.require(id, ['signed', 'broadcasting', 'unknown', 'relayed', 'confirmed']);
    this.#pending = { ...pending, status: confirmed ? 'confirmed' : 'relayed' };
  }

  unobserved(id: string): void {
    const pending = this.require(id, ['signed', 'broadcasting', 'unknown', 'relayed', 'confirmed']);
    this.#pending = { ...pending, status: 'unknown' };
  }

  cancel(id: string): void {
    this.require(id, ['prepared', 'signed']);
    this.#pending = null;
  }
}
