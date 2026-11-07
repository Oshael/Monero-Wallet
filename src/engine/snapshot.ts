import { height, nodeConnection, object, text, WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import {
  pendingTransfer,
  encodeTransferRecovery,
  decodeTransferRecovery,
} from '../transactions/index.ts';
import type { PendingTransfer } from '../transactions/index.ts';

const MAXIMUM = 128 * 1024 * 1024;
const LEGACY_HEADER = 16;
const FIXED_HEADER = 20;
const METADATA_MAXIMUM = 16_384;

export interface EngineMetadata {
  version: 1;
  network: 'stagenet';
  restoreHeight: number;
  backupVerified: boolean;
  enginePassword: string;
  node: NodeConnection | null;
  pending: PendingTransfer | null;
}

export interface EngineSnapshot {
  metadata: EngineMetadata;
  keys: Uint8Array<ArrayBuffer>;
  cache: Uint8Array<ArrayBuffer>;
}

export function encodeSnapshot(snapshot: EngineSnapshot): ArrayBuffer {
  if (snapshot.keys.byteLength === 0) throw new WalletError('invalid-snapshot');
  const { pending, ...settings } = snapshot.metadata;
  const metadata = new TextEncoder().encode(JSON.stringify(settings));
  let recovery: Uint8Array<ArrayBuffer> | undefined;
  try {
    recovery = encodeTransferRecovery(pending);
    const total =
      FIXED_HEADER +
      metadata.byteLength +
      snapshot.keys.byteLength +
      snapshot.cache.byteLength +
      recovery.byteLength;
    if (metadata.byteLength > METADATA_MAXIMUM || total > MAXIMUM)
      throw new WalletError('snapshot-too-large');
    const bytes = new Uint8Array(total);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, 2);
    header.setUint32(4, metadata.byteLength);
    header.setUint32(8, snapshot.keys.byteLength);
    header.setUint32(12, snapshot.cache.byteLength);
    header.setUint32(16, recovery.byteLength);
    bytes.set(metadata, FIXED_HEADER);
    bytes.set(snapshot.keys, FIXED_HEADER + metadata.byteLength);
    bytes.set(snapshot.cache, FIXED_HEADER + metadata.byteLength + snapshot.keys.byteLength);
    bytes.set(recovery, total - recovery.byteLength);
    return bytes.buffer;
  } finally {
    metadata.fill(0);
    recovery?.fill(0);
  }
}

export function decodeSnapshot(buffer: ArrayBuffer): EngineSnapshot {
  const layout = readLayout(buffer);
  const bytes = new Uint8Array(buffer);
  const metadataValue: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(layout.headerLength, layout.keysOffset),
    ),
  );
  if (layout.version === 2 && 'pending' in object(metadataValue))
    throw new WalletError('invalid-snapshot');
  const metadata = decodeMetadata(metadataValue);
  if (layout.version === 2)
    metadata.pending = decodeTransferRecovery(bytes.subarray(layout.recoveryOffset));
  return {
    metadata,
    keys: bytes.slice(layout.keysOffset, layout.cacheOffset),
    cache: bytes.slice(layout.cacheOffset, layout.recoveryOffset),
  };
}

function readLayout(buffer: ArrayBuffer): {
  version: number;
  headerLength: number;
  keysOffset: number;
  cacheOffset: number;
  recoveryOffset: number;
} {
  if (buffer.byteLength < LEGACY_HEADER || buffer.byteLength > MAXIMUM) {
    throw new WalletError('invalid-snapshot');
  }
  const header = new DataView(buffer);
  const version = header.getUint32(0);
  const headerLength = version === 1 ? LEGACY_HEADER : FIXED_HEADER;
  if (![1, 2].includes(version) || buffer.byteLength < headerLength)
    throw new WalletError('invalid-snapshot');
  const metaLength = header.getUint32(4);
  const keysLength = header.getUint32(8);
  const cacheLength = header.getUint32(12);
  const recoveryLength = version === 1 ? 0 : header.getUint32(16);
  const total = headerLength + metaLength + keysLength + cacheLength + recoveryLength;
  if (metaLength > METADATA_MAXIMUM || total !== buffer.byteLength || keysLength === 0) {
    throw new WalletError('invalid-snapshot');
  }
  const keysOffset = headerLength + metaLength;
  const cacheOffset = keysOffset + keysLength;
  return {
    version,
    headerLength,
    keysOffset,
    cacheOffset,
    recoveryOffset: cacheOffset + cacheLength,
  };
}

function decodeMetadata(value: unknown): EngineMetadata {
  const data = object(value);
  if (
    data.version !== 1 ||
    data.network !== 'stagenet' ||
    typeof data.backupVerified !== 'boolean'
  ) {
    throw new WalletError('unsupported-snapshot');
  }
  const enginePassword = text(data.enginePassword, 64);
  if (!/^[0-9a-f]{64}$/.test(enginePassword)) throw new WalletError('invalid-snapshot');
  return {
    version: 1,
    network: 'stagenet',
    restoreHeight: height(data.restoreHeight),
    backupVerified: data.backupVerified,
    enginePassword,
    node: data.node === null ? null : nodeConnection(data.node),
    pending: data.pending === undefined ? null : pendingTransfer(data.pending),
  };
}
