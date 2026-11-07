import { height, object, WalletError } from './validation.ts';

export interface NodeChainStatus {
  height: number;
  targetHeight: number;
  synced: boolean;
}

export type NodeNetwork = 'stagenet' | 'mainnet' | 'fakechain';

export function decodeNodeStatus(value: unknown, network: NodeNetwork): NodeChainStatus {
  const data = object(value);
  if (data.status !== 'OK' || data.nettype !== network || typeof data.synchronized !== 'boolean')
    throw new WalletError('invalid-node-status');
  return {
    height: height(data.height),
    targetHeight: height(data.target_height),
    synced: data.synchronized,
  };
}
