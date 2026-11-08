import { object, WalletError } from '../../domain/validation.ts';
import type { LightWalletTransport } from './transport.ts';

export async function readLightServerVersion(
  transport: LightWalletTransport,
  network: 'stagenet' | 'mainnet',
): Promise<Record<string, unknown>> {
  const version = object(await transport.request('get_version'));
  const expected = network === 'stagenet' ? 'stage' : 'main';
  if (version.network_type !== expected) throw new WalletError('wrong-light-network');
  return version;
}
