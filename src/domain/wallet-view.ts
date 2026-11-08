import { atomic, height, object, text, WalletError } from './validation.ts';

export interface WalletView {
  address: string;
  height: number;
  targetHeight: number;
  balance: string;
  unlockedBalance: string;
  sync: 'offline' | 'syncing' | 'synced' | 'waiting-node' | 'waiting-scanner' | 'failed';
  backupVerified: boolean;
  pending: {
    id: string;
    hash: string;
    address: string;
    amount: string;
    fee: string;
    expiresAt: number;
    status: 'prepared' | 'signed' | 'broadcasting' | 'unknown' | 'relayed' | 'confirmed';
  } | null;
}

export function walletView(value: unknown): WalletView {
  const data = object(value);
  const sync = data.sync;
  if (
    !['offline', 'syncing', 'synced', 'waiting-node', 'waiting-scanner', 'failed'].includes(
      String(sync),
    )
  ) {
    throw new WalletError('invalid-input');
  }
  if (typeof data.backupVerified !== 'boolean') throw new WalletError('invalid-input');
  return {
    address: text(data.address, 106),
    height: height(data.height),
    targetHeight: height(data.targetHeight),
    balance: atomic(data.balance).toString(),
    unlockedBalance: atomic(data.unlockedBalance).toString(),
    sync: sync as WalletView['sync'],
    backupVerified: data.backupVerified,
    pending: pendingView(data.pending),
  };
}

function pendingView(value: unknown): WalletView['pending'] {
  if (value === null) return null;
  const data = object(value);
  const hash = text(data.hash, 64);
  if (hash && !/^[0-9a-f]{64}$/.test(hash)) throw new WalletError('invalid-input');
  const status = data.status;
  if (
    !['prepared', 'signed', 'broadcasting', 'unknown', 'relayed', 'confirmed'].includes(
      String(status),
    )
  ) {
    throw new WalletError('invalid-input');
  }
  return {
    id: text(data.id, 36),
    hash,
    address: text(data.address, 106),
    amount: atomic(data.amount).toString(),
    fee: atomic(data.fee).toString(),
    expiresAt: height(data.expiresAt),
    status: status as NonNullable<WalletView['pending']>['status'],
  };
}
