import { nodeConnection, object, text, WalletError } from '../../domain/validation.ts';
import { lightServicePhase, MAXIMUM_SCANNER_DELETIONS } from '../../domain/light-service.ts';
import type { LightServicePhase } from '../../domain/light-service.ts';
import { hex } from './values.ts';

export interface ScannerDeletionIntent {
  id: string;
  uri: string;
  token: string | null;
}

export interface LightRegistrationSettings {
  phase: LightServicePhase;
  current: string | null;
  pending: ScannerDeletionIntent[];
}

export function scannerUri(value: unknown): string {
  return nodeConnection({ uri: value, username: '', password: '' }).uri;
}

export function registrationSettings(
  value: unknown,
  uri: string | null,
): LightRegistrationSettings {
  const data = object(value);
  if (!Array.isArray(data.pending) || data.pending.length > MAXIMUM_SCANNER_DELETIONS) {
    throw new WalletError('invalid-light-registration');
  }
  const pending = data.pending.map(deletionIntent);
  if (new Set(pending.map((intent) => intent.id)).size !== pending.length) {
    throw new WalletError('invalid-light-registration');
  }
  const phase = lightServicePhase(data.phase);
  const current = data.current === null ? null : deletionId(data.current);
  const selected = pending.find((intent) => intent.id === current);
  if (phase === 'deleting') {
    if (selected?.uri !== uri) throw new WalletError('invalid-light-registration');
  } else if (current !== null) throw new WalletError('invalid-light-registration');
  return { phase, current, pending };
}

function deletionIntent(value: unknown): ScannerDeletionIntent {
  const data = object(value);
  return {
    id: deletionId(data.id),
    uri: scannerUri(data.uri),
    token: data.token === null ? null : hex(data.token),
  };
}

function deletionId(value: unknown): string {
  const id = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new WalletError('invalid-light-registration');
  }
  return id;
}
