import { height, nodeConnection, object, WalletError } from '../../domain/validation.ts';

export interface LightWalletSettings {
  uri: string | null;
  height: number;
  adoptLegacy: boolean;
}

export function lightWalletSettings(value: unknown): LightWalletSettings {
  const data = object(value);
  const current = height(data.height);
  if (current > 1_000_000_000 || typeof data.adoptLegacy !== 'boolean') {
    throw new WalletError('invalid-light-settings');
  }
  if (data.uri === null) {
    if (current !== 0 || data.adoptLegacy) throw new WalletError('invalid-light-settings');
    return { uri: null, height: 0, adoptLegacy: false };
  }
  return {
    uri: nodeConnection({ uri: data.uri, username: '', password: '' }).uri,
    height: current,
    adoptLegacy: data.adoptLegacy,
  };
}
