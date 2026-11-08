import { atomic, text, WalletError } from '../../domain/validation.ts';

export function unsigned(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new WalletError('invalid-light-data');
    return atomic(String(value)).toString();
  }
  return atomic(value).toString();
}

export function integer(value: unknown): number {
  const parsed = BigInt(unsigned(value));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new WalletError('invalid-light-data');
  return Number(parsed);
}

export function hex(value: unknown, bytes = 32): string {
  const encoded = text(value, bytes * 2);
  if (encoded.length !== bytes * 2 || !/^[0-9a-f]+$/i.test(encoded)) {
    throw new WalletError('invalid-light-data');
  }
  return encoded.toLowerCase();
}

export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new WalletError('invalid-light-data');
  return value;
}

export function list(
  value: unknown,
  kind: 'outputs' | 'transactions' | 'spend-key-images' = 'outputs',
): unknown[] {
  if (!Array.isArray(value)) throw new WalletError(`invalid-light-${kind}`);
  if (value.length > 10_000) throw new WalletError('light-data-too-large');
  return value as unknown[];
}

export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    throw new WalletError('invalid-light-data');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new WalletError('invalid-light-data');
  if (new Date(parsed).toISOString() !== value.replace('Z', '.000Z')) {
    throw new WalletError('invalid-light-data');
  }
  return String(parsed / 1000);
}
