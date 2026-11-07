import { MoneroWalletListener } from 'wallet-engine-client';
import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../domain/validation.ts';
import type { NativeWalletState } from './wallet-state.ts';

class ProgressListener extends MoneroWalletListener {
  readonly #state: NativeWalletState;

  constructor(state: NativeWalletState) {
    super();
    this.#state = state;
  }

  override async onSyncProgress(current: number, _start: number, end: number): Promise<void> {
    this.#state.recordProgress(current, end);
    await Promise.resolve();
  }

  override async onBalancesChanged(balance: bigint, unlocked: bigint): Promise<void> {
    this.#state.recordBalances(balance, unlocked);
    await Promise.resolve();
  }
}

export class WalletSync {
  readonly #wallet: CandidateWallet;
  readonly #state: NativeWalletState;
  #running: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(wallet: CandidateWallet, state: NativeWalletState) {
    this.#wallet = wallet;
    this.#state = state;
  }

  start(): void {
    if (this.#running) throw new WalletError('sync-busy');
    this.#state.startScan();
    this.#running = this.#run().finally(() => {
      clearTimeout(this.#timer);
      this.#running = undefined;
    });
    this.#timer = setTimeout(() => {
      void this.stop().catch(() => {
        this.#state.failScan();
      });
    }, 60_000);
  }

  async stop(): Promise<void> {
    clearTimeout(this.#timer);
    const running = this.#running;
    if (running) {
      await this.#wallet.stopSyncing();
      await running;
    }
    this.#state.stopScan();
  }

  async #run(): Promise<void> {
    try {
      if (!(await this.#state.canScan())) return;
      await this.#wallet.sync(new ProgressListener(this.#state));
      await this.#state.completeScan();
    } catch {
      this.#state.failScan();
    }
  }
}
