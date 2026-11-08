import type { CandidateWallet } from 'wallet-engine-client';
import type { NodeConnection } from '../domain/validation.ts';
import { WalletError } from '../domain/validation.ts';
import type { NodeChainStatus, NodeNetwork } from '../domain/node-status.ts';
import { readNodeStatus } from './node-status.ts';

export class NodeConnectionOwner {
  readonly #wallet: Pick<CandidateWallet, 'setDaemonConnection'>;
  readonly #network: NodeNetwork;
  #selected: NodeConnection | null = null;

  constructor(wallet: Pick<CandidateWallet, 'setDaemonConnection'>, network: NodeNetwork) {
    this.#wallet = wallet;
    this.#network = network;
  }

  async select(node: NodeConnection): Promise<void> {
    // A failed native reconfiguration must not leave a stale selection usable.
    this.#selected = null;
    await this.#wallet.setDaemonConnection({ ...node }, false);
    this.#selected = { ...node };
  }

  snapshot(): NodeConnection | null {
    return this.#selected ? { ...this.#selected } : null;
  }

  async read(): Promise<NodeChainStatus> {
    if (!this.#selected) throw new WalletError('node-required');
    return readNodeStatus(this.#selected, this.#network);
  }
}
