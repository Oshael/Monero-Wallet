import { atomic, object, text, WalletError } from '../domain/validation.ts';
import { decodeIntent } from './intent.ts';
import type { SendIntent } from './intent.ts';
import type { WalletView } from '../domain/wallet-view.ts';

export const MAX_TRANSACTION_HEX_CHARACTERS = 32 * 1024 * 1024;

export interface SendPreview {
  id: string;
  address: string;
  amount: string;
  fee: string;
  expiresAt: number;
}

export interface PendingTransfer {
  intent: SendIntent;
  fee: string;
  unsignedHex: string;
  signedHex: string;
  hash: string;
  status: 'prepared' | 'signed' | 'broadcasting' | 'unknown' | 'relayed' | 'confirmed';
}

export type TransferStatus = NonNullable<WalletView['pending']>;

export function pendingTransfer(value: unknown): PendingTransfer | null {
  if (value === null) return null;
  const data = object(value);
  const status = data.status;
  if (
    !['prepared', 'signed', 'broadcasting', 'unknown', 'relayed', 'confirmed'].includes(
      String(status),
    )
  ) {
    throw new WalletError('invalid-pending-transfer');
  }
  const hash = text(data.hash, 64);
  if (hash && !/^[0-9a-f]{64}$/.test(hash)) throw new WalletError('invalid-pending-transfer');
  return {
    intent: decodeIntent(data.intent),
    fee: atomic(data.fee).toString(),
    unsignedHex: transactionHex(data.unsignedHex),
    signedHex: transactionHex(data.signedHex),
    hash,
    status: status as PendingTransfer['status'],
  };
}

function transactionHex(value: unknown): string {
  const hex = text(value, MAX_TRANSACTION_HEX_CHARACTERS);
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new WalletError('invalid-pending-transfer');
  return hex;
}

export function previewTransfer(transfer: PendingTransfer): SendPreview {
  return {
    id: transfer.intent.id,
    address: transfer.intent.address,
    amount: transfer.intent.amount,
    fee: transfer.fee,
    expiresAt: transfer.intent.expiresAt,
  };
}
