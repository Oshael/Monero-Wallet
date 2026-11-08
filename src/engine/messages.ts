import { height, nodeConnection, object, text, WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import { walletView } from '../domain/wallet-view.ts';
import type { WalletView } from '../domain/wallet-view.ts';
import { decodeIntent } from '../transactions/index.ts';
import type { SendIntent, SendPreview } from '../transactions/index.ts';

export type TransferCommand =
  | { kind: 'prepare-send'; intent: SendIntent }
  | { kind: 'approve-send' | 'arm-send' | 'broadcast-send' | 'cancel-send'; id: string }
  | { kind: 'reconcile-send' };

export type ConnectionCommand =
  | { kind: 'node'; node: NodeConnection }
  | { kind: 'light-service'; uri: string; node: NodeConnection };

export type EngineCommand =
  | { kind: 'create'; seed: string; restoreHeight: number }
  | { kind: 'open'; snapshot: ArrayBuffer }
  | { kind: 'snapshot' }
  | { kind: 'view' }
  | { kind: 'seed' }
  | { kind: 'verify-seed'; seed: string }
  | ConnectionCommand
  | { kind: 'start-sync' }
  | { kind: 'stop-sync' }
  | { kind: 'subaddress'; label: string }
  | { kind: 'addresses' }
  | TransferCommand;

export function isTransferCommand(command: EngineCommand): command is TransferCommand {
  return command.kind.endsWith('-send');
}

export function isConnectionCommand(command: EngineCommand): command is ConnectionCommand {
  return command.kind === 'node' || command.kind === 'light-service';
}

export type EngineReply =
  | { kind: 'view'; view: WalletView }
  | { kind: 'snapshot'; snapshot: ArrayBuffer }
  | { kind: 'seed'; seed: string }
  | { kind: 'addresses'; addresses: { address: string; label: string }[] }
  | { kind: 'send-preview'; preview: SendPreview };

function snapshotBuffer(value: unknown): ArrayBuffer {
  if (!(value instanceof ArrayBuffer) || value.byteLength > 128 * 1024 * 1024) {
    throw new WalletError('invalid-snapshot');
  }
  return value;
}

export function decodeCommand(value: unknown): EngineCommand {
  const data = object(value);
  switch (data.kind) {
    case 'create':
      return {
        kind: 'create',
        seed: text(data.seed, 4096),
        restoreHeight: height(data.restoreHeight),
      };
    case 'open':
      return { kind: 'open', snapshot: snapshotBuffer(data.snapshot) };
    case 'verify-seed':
      return { kind: 'verify-seed', seed: text(data.seed, 4096) };
    case 'node':
      return { kind: 'node', node: nodeConnection(data.node) };
    case 'light-service':
      return {
        kind: 'light-service',
        uri: nodeConnection({ uri: data.uri, username: '', password: '' }).uri,
        node: nodeConnection(data.node),
      };
    case 'subaddress':
      return { kind: 'subaddress', label: text(data.label, 128) };
    case 'prepare-send':
      return { kind: 'prepare-send', intent: decodeIntent(data.intent) };
    default:
      return transferOrSimple(data);
  }
}

function transferOrSimple(data: Record<string, unknown>): EngineCommand {
  switch (data.kind) {
    case 'approve-send':
    case 'arm-send':
    case 'broadcast-send':
    case 'cancel-send':
      return { kind: data.kind, id: text(data.id, 36) };
    default:
      return simpleCommand(data.kind);
  }
}

function simpleCommand(value: unknown): EngineCommand {
  switch (value) {
    case 'snapshot':
    case 'view':
    case 'seed':
    case 'start-sync':
    case 'stop-sync':
    case 'addresses':
    case 'reconcile-send':
      return { kind: value };
    default:
      throw new WalletError('invalid-command');
  }
}

export function decodeReply(value: unknown): EngineReply {
  const data = object(value);
  switch (data.kind) {
    case 'view':
      return { kind: 'view', view: walletView(data.view) };
    case 'snapshot':
      return { kind: 'snapshot', snapshot: snapshotBuffer(data.snapshot) };
    case 'seed':
      return { kind: 'seed', seed: text(data.seed, 4096) };
    case 'send-preview': {
      const preview = object(data.preview);
      return {
        kind: 'send-preview',
        preview: {
          id: text(preview.id, 36),
          address: text(preview.address, 106),
          amount: text(preview.amount, 20),
          fee: text(preview.fee, 20),
          expiresAt: height(preview.expiresAt),
        },
      };
    }
    case 'addresses': {
      if (!Array.isArray(data.addresses) || data.addresses.length > 1000) {
        throw new WalletError('too-many-addresses');
      }
      return { kind: 'addresses', addresses: data.addresses.map(addressValue) };
    }
    default:
      throw new WalletError('invalid-reply');
  }
}

function addressValue(value: unknown): { address: string; label: string } {
  const data = object(value);
  return { address: text(data.address, 106), label: text(data.label, 128) };
}
