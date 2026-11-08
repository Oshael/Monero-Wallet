import type { CandidateWallet } from 'wallet-engine-client';
import type { WalletView } from '../domain/wallet-view.ts';
import type { NodeChainStatus } from '../domain/node-status.ts';
import { WalletError } from '../domain/validation.ts';
import { readChainState } from './chain-state.ts';

type NativeReader = Pick<CandidateWallet, 'getHeight' | 'getBalance' | 'getUnlockedBalance'>;
type NativeView = Pick<
  WalletView,
  'height' | 'targetHeight' | 'balance' | 'unlockedBalance' | 'sync'
>;

export class NativeWalletState {
  readonly #wallet: NativeReader;
  readonly #readNode: () => Promise<NodeChainStatus>;
  readonly #view: NativeView;

  private constructor(
    wallet: NativeReader,
    readNode: () => Promise<NodeChainStatus>,
    view: NativeView,
  ) {
    this.#wallet = wallet;
    this.#readNode = readNode;
    this.#view = view;
  }

  static async create(
    wallet: NativeReader,
    readNode: () => Promise<NodeChainStatus>,
  ): Promise<NativeWalletState> {
    return new NativeWalletState(wallet, readNode, {
      height: await wallet.getHeight(),
      targetHeight: 0,
      sync: 'offline',
      balance: (await wallet.getBalance()).toString(),
      unlockedBalance: (await wallet.getUnlockedBalance()).toString(),
    });
  }

  get status(): NativeView['sync'] {
    return this.#view.sync;
  }

  view(): NativeView {
    return { ...this.#view };
  }

  startScan(): void {
    this.#view.sync = 'syncing';
  }

  recordProgress(current: number, target: number): void {
    this.#view.height = current;
    this.#view.targetHeight = target;
  }

  recordBalances(balance: bigint, unlocked: bigint): void {
    this.#view.balance = balance.toString();
    this.#view.unlockedBalance = unlocked.toString();
  }

  waitForScanner(progress: { height: number; targetHeight: number }): void {
    this.recordProgress(progress.height, progress.targetHeight);
    this.#view.sync = 'waiting-scanner';
  }

  async canScan(): Promise<boolean> {
    const chain = await this.#scanTarget();
    if (chain.nodeReady && chain.walletHeight <= chain.targetHeight) return true;
    // Waiting is entered before a native scan; it has no new cache to checkpoint.
    this.#waitForNode(chain.walletHeight);
    return false;
  }

  async canImportLightData(): Promise<boolean> {
    const chain = await this.#scanTarget();
    // A verified replacement snapshot must also recover a node tip that moved backwards.
    if (chain.nodeReady) return true;
    this.#waitForNode(chain.walletHeight);
    return false;
  }

  async #scanTarget(): Promise<Awaited<ReturnType<typeof readChainState>>> {
    const chain = await readChainState(this.#wallet, this.#readNode);
    this.#view.targetHeight = chain.targetHeight;
    return chain;
  }

  #waitForNode(walletHeight: number): void {
    this.#view.height = walletHeight;
    this.#view.sync = 'waiting-node';
  }

  async completeScan(): Promise<void> {
    const chain = await readChainState(this.#wallet, this.#readNode);
    this.recordProgress(chain.walletHeight, chain.targetHeight);
    await this.refreshBalances();
    this.#view.sync = chain.synced ? 'synced' : 'offline';
  }

  stopScan(): void {
    this.#view.sync = 'offline';
  }

  failScan(): void {
    this.#view.sync = 'failed';
  }

  async refreshBalances(): Promise<void> {
    this.recordBalances(await this.#wallet.getBalance(), await this.#wallet.getUnlockedBalance());
  }

  async afterBroadcast(): Promise<void> {
    this.#view.sync = 'offline';
    await this.refreshBalances();
  }

  async assertSpendable(): Promise<void> {
    if (
      this.#view.sync !== 'synced' ||
      !(await readChainState(this.#wallet, this.#readNode)).synced
    )
      throw new WalletError('synchronization-required');
  }
}
