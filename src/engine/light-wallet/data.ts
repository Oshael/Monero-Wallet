import { object, WalletError } from '../../domain/validation.ts';
import type { NodeChainStatus } from '../../domain/node-status.ts';
import { boolean, hex, integer, list, timestamp, unsigned } from './values.ts';

interface TransactionMetadata {
  hash: string;
  height: number;
  unlockTime: string;
  coinbase: boolean;
}

interface ImportedOutput {
  amount: string;
  public_key: string;
  index: number;
  global_index: string;
  tx_hash: string;
  tx_pub_key: string;
  spend_key_images: string[];
  height: number;
  timestamp: string;
  recipient: { major: number; minor: number };
  coinbase: boolean;
  unlock_time: string;
  rct?: string;
}

export interface LightWalletData {
  height: number;
  outputs: ImportedOutput[];
  confirmed: { hash: string; height: number }[];
}

export function lightWalletProgress(
  info: unknown,
  node: NodeChainStatus,
): {
  height: number;
  targetHeight: number;
  current: boolean;
} {
  const data = object(info);
  const scanned = integer(data.scanned_block_height);
  const target = integer(data.blockchain_height);
  if (scanned > target || target >= 1_000_000_000) throw new WalletError('invalid-light-data');
  assertLookahead(data);
  const nodeHeight = integer(node.height);
  const nodeTarget = integer(node.targetHeight);
  return {
    height: scanned + 1,
    targetHeight: Math.max(target + 1, nodeHeight, nodeTarget),
    current:
      node.synced && nodeTarget <= nodeHeight && scanned === target && scanned + 1 === nodeHeight,
  };
}

function assertLookahead(data: Record<string, unknown>): void {
  if (data.lookahead_fail !== undefined && integer(data.lookahead_fail) !== 0) {
    throw new WalletError('light-subaddress-scan-incomplete');
  }
}

export function decodeLightWalletData(input: {
  info: unknown;
  transactions: unknown;
  outputs: unknown;
  node: NodeChainStatus;
}): LightWalletData {
  const scan = scanStatus(input.info);
  const history = object(input.transactions);
  const historyScan = scanStatus(history);
  if (scan !== historyScan) throw new WalletError('light-scan-changed');
  if (
    !input.node.synced ||
    input.node.targetHeight > input.node.height ||
    scan + 1 !== integer(input.node.height)
  ) {
    throw new WalletError('light-scanner-behind');
  }
  const transactions = transactionMetadata(history.transactions);
  const outputData = object(input.outputs);
  assertLookahead(outputData);
  const outputs = list(outputData.outputs === undefined ? [] : outputData.outputs);
  return {
    height: scan + 1,
    outputs: outputs.map((entry) => decodeOutput(entry, transactions, scan)),
    confirmed: [...transactions.values()].map(({ hash, height }) => ({ hash, height })),
  };
}

function scanStatus(value: unknown): number {
  const data = object(value);
  const scanned = integer(data.scanned_block_height);
  const target = integer(data.blockchain_height);
  if (scanned !== target || target >= 1_000_000_000) {
    throw new WalletError('light-scanner-behind');
  }
  assertLookahead(data);
  return scanned;
}

function transactionMetadata(value: unknown): Map<string, TransactionMetadata> {
  const entries = new Map<string, TransactionMetadata>();
  for (const raw of list(value === undefined ? [] : value, 'transactions')) {
    const data = object(raw);
    if (boolean(data.mempool)) continue;
    const transaction = {
      hash: hex(data.hash),
      height: integer(data.height),
      unlockTime: unsigned(data.unlock_time),
      coinbase: boolean(data.coinbase),
    };
    const previous = entries.get(transaction.hash);
    if (previous && JSON.stringify(previous) !== JSON.stringify(transaction)) {
      throw new WalletError('invalid-light-data');
    }
    entries.set(transaction.hash, transaction);
  }
  return entries;
}

function decodeOutput(
  value: unknown,
  transactions: Map<string, TransactionMetadata>,
  scanned: number,
): ImportedOutput {
  const data = object(value);
  const hash = hex(data.tx_hash);
  const transaction = transactions.get(hash);
  const height = integer(data.height);
  if (transaction?.height !== height || height > scanned) {
    throw new WalletError('invalid-light-data');
  }
  return {
    amount: unsigned(data.amount),
    public_key: hex(data.public_key),
    index: integer(data.index),
    global_index: unsigned(data.global_index),
    tx_hash: hash,
    tx_pub_key: hex(data.tx_pub_key),
    // LWS's wire library omits empty vector fields, including candidate spends.
    spend_key_images: list(
      data.spend_key_images === undefined ? [] : data.spend_key_images,
      'spend-key-images',
    ).map((image) => hex(image)),
    height,
    timestamp: timestamp(data.timestamp),
    recipient: recipient(data.recipient),
    coinbase: transaction.coinbase,
    unlock_time: transaction.unlockTime,
    ...commitment(data),
  };
}

function recipient(value: unknown): ImportedOutput['recipient'] {
  const data = object(value);
  const major = integer(data.maj_i);
  const minor = integer(data.min_i);
  if (major !== 0 || minor >= 1000) throw new WalletError('unsupported-light-subaddress');
  return { major, minor };
}

function commitment(data: Record<string, unknown>): Pick<ImportedOutput, 'rct'> {
  if (data.rct === undefined) return {};
  return { rct: hex(data.rct, 96) };
}
