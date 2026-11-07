export class WalletError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'WalletError';
    this.code = code;
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WalletError('invalid-input');
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) throw new WalletError('invalid-input');
  return value;
}

export function height(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WalletError('invalid-height');
  }
  return value;
}

export function atomic(value: unknown): bigint {
  const amount = text(value, 20);
  if (!/^(0|[1-9]\d{0,19})$/.test(amount)) throw new WalletError('invalid-amount');
  const parsed = BigInt(amount);
  if (parsed > (1n << 64n) - 1n) throw new WalletError('invalid-amount');
  return parsed;
}

export function parseAmount(value: string): bigint {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,12})?$/.test(value)) throw new WalletError('invalid-amount');
  const [whole = '0', fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
  if (result === 0n) throw new WalletError('invalid-amount');
  return result;
}

export function formatAmount(value: string): string {
  const amount = atomic(value);
  const whole = amount / 1_000_000_000_000n;
  const fraction = (amount % 1_000_000_000_000n).toString().padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export interface NodeConnection {
  uri: string;
  username: string;
  password: string;
}

export function nodeConnection(value: unknown): NodeConnection {
  const input = object(value);
  const uri = text(input.uri, 2048);
  const url = new URL(uri);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new WalletError('node-requires-https');
  }
  if (url.username || url.password || url.search || url.hash) throw new WalletError('invalid-node');
  return {
    uri: url.href.replace(/\/$/, ''),
    username: text(input.username, 256),
    password: text(input.password, 1024),
  };
}
