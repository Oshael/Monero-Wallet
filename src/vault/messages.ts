import { VaultError } from './errors.ts';
import { MAX_ENVELOPE_BYTES, MAX_PAYLOAD_BYTES } from './format.ts';

export type CryptoCommand =
  | { kind: 'create'; password: string }
  | { kind: 'open'; password: string; envelope: ArrayBuffer }
  | { kind: 'seal'; plaintext: ArrayBuffer }
  | { kind: 'verify'; envelope: ArrayBuffer }
  | { kind: 'verify-password'; password: string; envelope: ArrayBuffer }
  | { kind: 'prepare-password'; oldPassword: string; newPassword: string; envelope: ArrayBuffer }
  | { kind: 'seal-password'; plaintext: ArrayBuffer }
  | { kind: 'commit-password' }
  | { kind: 'abort-password' };

export type CryptoReply =
  | { kind: 'ready' }
  | { kind: 'plaintext'; plaintext: ArrayBuffer }
  | { kind: 'ciphertext'; envelope: ArrayBuffer };

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VaultError('invalid-format');
  }
  return value as Record<string, unknown>;
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024) throw new VaultError('password-invalid');
  return value;
}

function buffer(value: unknown, maximum: number): ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) throw new VaultError('invalid-format');
  if (value.byteLength > maximum) throw new VaultError('too-large');
  return value;
}

export function decodeCryptoCommand(value: unknown): CryptoCommand {
  const command = record(value);
  switch (command.kind) {
    case 'create':
      return { kind: 'create', password: password(command.password) };
    case 'open':
      return {
        kind: 'open',
        password: password(command.password),
        envelope: buffer(command.envelope, MAX_ENVELOPE_BYTES),
      };
    case 'seal':
    case 'seal-password':
      return { kind: command.kind, plaintext: buffer(command.plaintext, MAX_PAYLOAD_BYTES) };
    case 'verify':
      return { kind: 'verify', envelope: buffer(command.envelope, MAX_ENVELOPE_BYTES) };
    case 'verify-password':
      return {
        kind: 'verify-password',
        password: password(command.password),
        envelope: buffer(command.envelope, MAX_ENVELOPE_BYTES),
      };
    case 'prepare-password':
      return {
        kind: 'prepare-password',
        oldPassword: password(command.oldPassword),
        newPassword: password(command.newPassword),
        envelope: buffer(command.envelope, MAX_ENVELOPE_BYTES),
      };
    case 'commit-password':
    case 'abort-password':
      return { kind: command.kind };
    default:
      throw new VaultError('invalid-format');
  }
}

export function decodeCryptoReply(value: unknown): CryptoReply {
  const reply = record(value);
  switch (reply.kind) {
    case 'ready':
      return { kind: 'ready' };
    case 'plaintext':
      return { kind: 'plaintext', plaintext: buffer(reply.plaintext, MAX_PAYLOAD_BYTES) };
    case 'ciphertext':
      return { kind: 'ciphertext', envelope: buffer(reply.envelope, MAX_ENVELOPE_BYTES) };
    default:
      throw new VaultError('invalid-format');
  }
}
