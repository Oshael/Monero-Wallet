import { atomic, object, text, WalletError } from '../domain/validation.ts';

export interface SendIntent {
  id: string;
  network: 'stagenet';
  address: string;
  amount: string;
  maximumFee: string;
  expiresAt: number;
}

export interface InspectedTransaction {
  destinations: { address: string; amount: string }[];
  fee: string;
  changeAddress: string;
  changeAmount: string;
  unlockTime: string;
}

export function createIntent(input: {
  address: string;
  amount: string;
  maximumFee: string;
}): SendIntent {
  const address = text(input.address, 106);
  if (
    !/^(?:[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{95}|[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{106})$/.test(
      address,
    )
  ) {
    throw new WalletError('unsupported-address');
  }
  const amount = atomic(input.amount);
  const fee = atomic(input.maximumFee);
  if (amount <= 0n || fee <= 0n) throw new WalletError('invalid-amount');
  return Object.freeze({
    id: crypto.randomUUID(),
    network: 'stagenet',
    address,
    amount: amount.toString(),
    maximumFee: fee.toString(),
    expiresAt: Date.now() + 5 * 60_000,
  });
}

export function inspectTransaction(options: {
  intent: SendIntent;
  transaction: InspectedTransaction;
  ownsChange: boolean;
  now?: number;
}): void {
  const { intent, transaction } = options;
  if ((options.now ?? Date.now()) > intent.expiresAt) throw new WalletError('approval-expired');
  validateDestination(intent, transaction);
  validateFee(intent, transaction.fee);
  if (transaction.unlockTime !== '0') throw new WalletError('transaction-locked');
  if (atomic(transaction.changeAmount) > 0n && !options.ownsChange) {
    throw new WalletError('transaction-change-mismatch');
  }
}

function validateDestination(intent: SendIntent, transaction: InspectedTransaction): void {
  if (transaction.destinations.length !== 1) throw new WalletError('transaction-intent-mismatch');
  const destination = transaction.destinations[0];
  if (destination?.address !== intent.address || destination.amount !== intent.amount) {
    throw new WalletError('transaction-intent-mismatch');
  }
}

function validateFee(intent: SendIntent, fee: string): void {
  if (atomic(fee) > atomic(intent.maximumFee) || atomic(fee) === 0n) {
    throw new WalletError('transaction-fee-mismatch');
  }
}

export function decodeIntent(value: unknown): SendIntent {
  const data = object(value);
  if (
    data.network !== 'stagenet' ||
    typeof data.expiresAt !== 'number' ||
    !Number.isSafeInteger(data.expiresAt)
  ) {
    throw new WalletError('invalid-intent');
  }
  const id = text(data.id, 36);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new WalletError('invalid-intent');
  return {
    id,
    network: 'stagenet',
    address: text(data.address, 106),
    amount: atomic(data.amount).toString(),
    maximumFee: atomic(data.maximumFee).toString(),
    expiresAt: data.expiresAt,
  };
}
