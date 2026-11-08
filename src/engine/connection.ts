import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import { NodeConnectionOwner } from './node-connection.ts';
import { NativeWalletState } from './wallet-state.ts';
import { WalletSync } from './sync.ts';
import { LightWalletSync } from './light-wallet/sync.ts';
import { LightWalletRegistration } from './light-wallet/registration.ts';
import type { LightServiceView } from '../domain/light-service.ts';
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
  #registration: LightWalletRegistration | undefined;

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
    this.#registration?.assertSelectable(connection.uri);
    await this.#node.select(connection.node);
    this.#registration?.select(connection.uri);
    this.#sync = this.#synchronizer(
      previous
        ? { ...previous, uri: connection.uri }
        : { uri: connection.uri, height: 0, adoptLegacy: true },
    );
    this.state.stopScan();
  }

  lightServiceView(): LightServiceView | undefined {
    return this.#registration?.view();
  }

  async requestLightDeletion(): Promise<void> {
    await this.#sync.stop();
    this.#lightRegistration().requestDeletion();
  }

  async prepareLightDeletion(): Promise<void> {
    await this.#sync.stop();
    await this.#lightRegistration().prepareNext();
  }

  async finishLightDeletion(): Promise<void> {
    await this.#sync.stop();
    await this.#lightRegistration().finishNext();
  }

  #lightRegistration(): LightWalletRegistration {
    if (!this.#registration) throw new WalletError('light-service-required');
    return this.#registration;
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
    this.#registration ??= new LightWalletRegistration(
      this.#wallet,
      this.#opening.network,
      settings,
    );
    return new LightWalletSync(this.#wallet, this.state, {
      ...this.#opening,
      settings,
      registration: this.#registration,
      readNode: () => this.#node.read(),
    });
  }
}
