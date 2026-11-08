import { height, nodeConnection, object, WalletError } from './validation.ts';

// Bound retained intents; the snapshot encoder also enforces its byte budget.
export const MAXIMUM_SCANNER_DELETIONS = 4;
export type LightServicePhase = 'connected' | 'deleting' | 'deleted';

export interface LightServiceView {
  uri: string | null;
  phase: LightServicePhase;
  pendingDeletions: number;
  deletionOrigins: string[];
}

export function lightServicePhase(value: unknown): LightServicePhase {
  if (value === 'connected' || value === 'deleting' || value === 'deleted') return value;
  throw new WalletError('invalid-light-registration');
}

export function lightServiceView(value: unknown): LightServiceView {
  const data = object(value);
  const pendingDeletions = height(data.pendingDeletions);
  if (pendingDeletions > MAXIMUM_SCANNER_DELETIONS) {
    throw new WalletError('invalid-light-registration');
  }
  if (!Array.isArray(data.deletionOrigins) || data.deletionOrigins.length > pendingDeletions) {
    throw new WalletError('invalid-light-registration');
  }
  return {
    uri: data.uri === null ? null : serviceUri(data.uri),
    phase: lightServicePhase(data.phase),
    pendingDeletions,
    deletionOrigins: data.deletionOrigins.map((uri: unknown) => new URL(serviceUri(uri)).origin),
  };
}

function serviceUri(value: unknown): string {
  return nodeConnection({ uri: value, username: '', password: '' }).uri;
}
