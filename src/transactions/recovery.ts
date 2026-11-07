import { WalletError } from '../domain/validation.ts';
import { MAX_TRANSACTION_HEX_CHARACTERS, pendingTransfer } from './state.ts';
import type { PendingTransfer } from './state.ts';

const MAX_TRANSFER_RECOVERY_BYTES = 2 * MAX_TRANSACTION_HEX_CHARACTERS + 16_384;

export function encodeTransferRecovery(pending: PendingTransfer | null): Uint8Array<ArrayBuffer> {
  if (!pending) return new Uint8Array(0);
  const bytes = new TextEncoder().encode(JSON.stringify(pendingTransfer(pending)));
  if (bytes.byteLength > MAX_TRANSFER_RECOVERY_BYTES) {
    bytes.fill(0);
    throw new WalletError('transfer-too-large');
  }
  return bytes;
}

export function decodeTransferRecovery(bytes: Uint8Array): PendingTransfer | null {
  if (bytes.byteLength === 0) return null;
  if (bytes.byteLength > MAX_TRANSFER_RECOVERY_BYTES) throw new WalletError('transfer-too-large');
  const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return pendingTransfer(decoded);
}
