import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import { NodeConnectionOwner } from './node-connection.ts';
import { NativeWalletState } from './wallet-state.ts';
import { WalletSync } from './sync.ts';
import { LightWalletSync } from './light-wallet/sync.ts';
import type { LightWalletSettings } from './light-wallet/settings.ts';
import type { PreparationCheckpoint } from './transaction-signer.ts';

interface Options {
  node: NodeConnection | null;
  light?: LightWalletSettings;
  network: 'stagenet';
  restoreHeight: number;
}

type Synchronization = WalletSync | LightWalletSync;
type ConnectionWallet = Pick<
  CandidateWallet,
  | 'setDaemonConnection'
  | 'getHeight'
  | 'getBalance'
  | 'getUnlockedBalance'
  | 'getPrimaryAddress'
  | 'getPrivateViewKey'
  | 'importLightWalletData'
  | 'sync'
  | 'stopSyncing'
>;

export class WalletConnection {
  readonly state: NativeWalletState;
  readonly #wallet: ConnectionWallet;
  readonly #node: NodeConnectionOwner;
  readonly #opening: Pick<Options, 'network' | 'restoreHeight'>;
  #sync: Synchronization;

  private constructor(
    wallet: ConnectionWallet,
    state: NativeWalletState,
    node: NodeConnectionOwner,
    options: Options,
  ) {
    this.#wallet = wallet;
    this.state = state;
    this.#node = node;
    this.#opening = { network: options.network, restoreHeight: options.restoreHeight };
    this.#sync = this.#synchronizer(options.light);
  }

  static async create(wallet: ConnectionWallet, options: Options): Promise<WalletConnection> {
    const node = new NodeConnectionOwner(wallet, options.network);
    if (options.node) await node.select(options.node);
    const state = await NativeWalletState.create(wallet, () => node.read());
    return new WalletConnection(wallet, state, node, options);
  }

  snapshot(): Pick<Options, 'node' | 'light'> {
    this.assertHealthy();
    return {
      node: this.#node.snapshot(),
      ...(this.#sync instanceof LightWalletSync ? { light: this.#sync.checkpoint() } : {}),
    };
  }

  preparation(): PreparationCheckpoint {
    return this.#sync instanceof LightWalletSync
      ? { kind: 'light', height: this.#sync.checkpoint().height }
      : { kind: 'full' };
  }

  async selectNode(node: NodeConnection): Promise<void> {
    if (this.#sync instanceof LightWalletSync) throw new WalletError('light-service-required');
    await this.#sync.stop();
    await this.#node.select(node);
    this.state.stopScan();
  }

  async selectLight(connection: { uri: string; node: NodeConnection }): Promise<void> {
    await this.#sync.stop();
    const previous = this.snapshot().light;
    await this.#node.select(connection.node);
    this.#sync = this.#synchronizer(
      previous
        ? { ...previous, uri: connection.uri }
        : { uri: connection.uri, height: 0, adoptLegacy: true },
    );
    this.state.stopScan();
  }

  start(): void {
    if (!this.#node.snapshot()) throw new WalletError('node-required');
    this.#sync.start();
  }

  async stop(): Promise<void> {
    await this.#sync.stop();
  }

  assertHealthy(): void {
    this.#sync.assertHealthy();
  }

  #synchronizer(settings?: LightWalletSettings): Synchronization {
    if (!settings) return new WalletSync(this.#wallet, this.state);
    return new LightWalletSync(this.#wallet, this.state, {
      ...this.#opening,
      settings,
      readNode: () => this.#node.read(),
    });
  }
}
