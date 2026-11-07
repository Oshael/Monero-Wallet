import { HttpClient } from 'wallet-engine-client';
import { decodeNodeStatus } from '../domain/node-status.ts';
import type { NodeChainStatus, NodeNetwork } from '../domain/node-status.ts';
import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';

// This check deliberately bypasses the native RPC proxy's cached height.
export async function readNodeStatus(
  node: NodeConnection,
  network: NodeNetwork,
): Promise<NodeChainStatus> {
  const response = await HttpClient.request({
    uri: `${node.uri}/get_info`,
    method: 'POST',
    body: '{}',
    username: node.username,
    password: node.password,
    resolveWithFullResponse: true,
  });
  if (response.statusCode !== 200) throw new WalletError('node-unavailable');
  if (response.body.length > 64 * 1024) throw new WalletError('invalid-node-status');
  return decodeNodeStatus(JSON.parse(response.body) as unknown, network);
}
