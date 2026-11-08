import type { CandidateWallet } from 'wallet-engine-client';
import type { NodeChainStatus } from '../../domain/node-status.ts';
import { WalletError } from '../../domain/validation.ts';
import type { NativeWalletState } from '../wallet-state.ts';
import { LightWalletClient } from './client.ts';
import type { LightWalletData } from './data.ts';
import type { LightWalletSettings } from './settings.ts';
import type { LightWalletRegistration } from './registration.ts';

interface Options {
  network: 'stagenet' | 'mainnet';
  restoreHeight: number;
  settings: LightWalletSettings;
  registration: LightWalletRegistration;
  readNode: () => Promise<NodeChainStatus>;
}

type LightWallet = Pick<
  CandidateWallet,
  'getPrimaryAddress' | 'getPrivateViewKey' | 'importLightWalletData'
>;

export class LightWalletSync {
  readonly #wallet: LightWallet;
  readonly #state: NativeWalletState;
  readonly #options: Omit<Options, 'settings' | 'registration'>;
  readonly #registration: LightWalletRegistration;
  #checkpoint: Pick<LightWalletSettings, 'height' | 'adoptLegacy'>;
  #running: Promise<void> | undefined;
  #controller: AbortController | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #fatal: WebAssembly.RuntimeError | undefined;

  constructor(wallet: LightWallet, state: NativeWalletState, options: Options) {
    this.#wallet = wallet;
    this.#state = state;
    const { settings, registration, ...operation } = options;
    this.#options = operation;
    this.#registration = registration;
    this.#checkpoint = { height: settings.height, adoptLegacy: settings.adoptLegacy };
  }

  checkpoint(): LightWalletSettings {
    this.assertHealthy();
    return { ...this.#registration.checkpoint(), ...this.#checkpoint };
  }

  start(): void {
    this.assertHealthy();
    if (this.#running) throw new WalletError('sync-busy');
    const uri = this.#registration.syncUri();
    const controller = new AbortController();
    this.#controller = controller;
    this.#state.startScan();
    this.#running = this.#run(controller, uri).finally(() => {
      clearTimeout(this.#timer);
      this.#controller = undefined;
      this.#running = undefined;
    });
    this.#timer = setTimeout(() => {
      controller.abort();
    }, 60_000);
  }

  async stop(): Promise<void> {
    clearTimeout(this.#timer);
    this.#controller?.abort();
    await this.#running;
    this.assertHealthy();
    this.#state.stopScan();
  }

  assertHealthy(): void {
    if (this.#fatal) throw this.#fatal;
  }

  async #run(controller: AbortController, uri: string): Promise<void> {
    let client: LightWalletClient | undefined;
    try {
      if (!(await this.#state.canImportLightData())) return;
      client = await LightWalletClient.open({
        uri,
        network: this.#options.network,
        restoreHeight: this.#options.restoreHeight,
        credentials: {
          address: await this.#wallet.getPrimaryAddress(),
          view_key: await this.#wallet.getPrivateViewKey(),
        },
        signal: controller.signal,
      });
      const data = await client.read(this.#options.readNode);
      if (controller.signal.aborted) return;
      await this.#apply(data, controller);
    } catch (error) {
      this.#failed({ error, controller, progress: client?.progress });
    } finally {
      client?.dispose();
      if (controller.signal.aborted && !this.#fatal) this.#state.stopScan();
    }
  }

  async #apply(data: LightWalletData, controller: AbortController): Promise<void> {
    await this.#wallet.importLightWalletData(
      JSON.stringify({
        ...data,
        ...(this.#checkpoint.adoptLegacy ? { adopt_legacy: true } : {}),
      }),
    );
    // Publish the matching height even if cancellation arrives during native import.
    this.#checkpoint = { ...this.#checkpoint, height: data.height, adoptLegacy: false };
    if (controller.signal.aborted) await this.#state.refreshBalances();
    else await this.#state.completeScan();
  }

  #failed(input: {
    error: unknown;
    controller: AbortController;
    progress: { height: number; targetHeight: number } | undefined;
  }): void {
    if (input.error instanceof WebAssembly.RuntimeError) {
      this.#fatal = input.error;
      this.#state.failScan();
      return;
    }
    if (input.controller.signal.aborted) return;
    if (isWaiting(input.error)) {
      this.#state.waitForScanner(
        input.progress ?? {
          height: this.#checkpoint.height,
          targetHeight: this.#state.view().targetHeight,
        },
      );
      return;
    }
    this.#state.failScan();
  }
}

function isWaiting(error: unknown): boolean {
  return (
    error instanceof WalletError &&
    ['light-scanner-behind', 'light-scan-changed', 'light-import-awaiting-approval'].includes(
      error.code,
    )
  );
}
