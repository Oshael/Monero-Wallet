import type { CandidateWallet } from 'wallet-engine-client';
import { height } from '../domain/validation.ts';
import type { NodeChainStatus } from '../domain/node-status.ts';

type ChainReader = Pick<CandidateWallet, 'getHeight'>;

export async function readChainState(
  wallet: ChainReader,
  readNode: () => Promise<NodeChainStatus>,
): Promise<{
  walletHeight: number;
  targetHeight: number;
  nodeReady: boolean;
  synced: boolean;
}> {
  const walletHeight = height(await wallet.getHeight());
  const node = await readNode();
  const daemonHeight = height(node.height);
  const peerHeight = height(node.targetHeight);
  const daemonSynced = node.synced;
  const targetHeight = Math.max(daemonHeight, peerHeight);
  const nodeReady = daemonSynced && daemonHeight > 0 && daemonHeight >= peerHeight;
  return {
    walletHeight,
    targetHeight,
    nodeReady,
    synced: nodeReady && walletHeight === targetHeight,
  };
}
