import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import type { WalletView } from '../domain/wallet-view.ts';
import { WalletEngine } from '../engine/index.ts';
import { Vault } from '../vault/index.ts';
import { ExclusiveSession } from './exclusive-session.ts';
import { IdleLock } from './idle-lock.ts';
import { SendWorkflow } from './send.ts';
import type { SendPreview } from '../transactions/index.ts';

interface UnlockedSession {
  engine: WalletEngine;
  vault: Vault;
  abort: AbortController;
  idle: IdleLock;
  exclusive: ExclusiveSession;
  sends: SendWorkflow;
}

type StartOperation =
  | { kind: 'create'; password: string; seed: string; restoreHeight: number }
  | { kind: 'open'; password: string }
  | { kind: 'recover'; password: string }
  | { kind: 'import'; password: string; envelope: ArrayBuffer };

export class WalletSession extends EventTarget {
  #active: UnlockedSession | undefined;
  #starting: AbortController | undefined;
  #busy = false;
  #poll: ReturnType<typeof setTimeout> | undefined;
  #view: WalletView | undefined;
  #syncRequested = false;

  get view(): WalletView | undefined {
    return this.#view ? structuredClone(this.#view) : undefined;
  }

  async exists(): Promise<boolean> {
    return Vault.exists();
  }

  async create(options: {
    password: string;
    seed?: string;
    restoreHeight?: number;
  }): Promise<void> {
    await this.#start({
      kind: 'create',
      password: options.password,
      seed: options.seed ?? '',
      restoreHeight: options.restoreHeight ?? 0,
    });
  }

  async unlock(password: string): Promise<void> {
    await this.#start({ kind: 'open', password });
  }

  async recoverPrevious(password: string): Promise<void> {
    await this.#start({ kind: 'recover', password });
  }

  async importBackup(envelope: ArrayBuffer, password: string): Promise<void> {
    await this.#start({ kind: 'import', password, envelope });
  }

  async seed(password: string): Promise<string> {
    return this.#operation(async (active) => {
      await active.vault.verifyPassword(password);
      return active.engine.seed();
    });
  }

  async verifySeed(seed: string): Promise<void> {
    await this.#operation(async (active) => {
      const view = await active.engine.verifySeed(seed);
      await this.#checkpoint(active);
      this.#update(view);
    });
  }

  async connect(node: NodeConnection): Promise<void> {
    await this.#operation(async (active) => {
      const view = await active.engine.connect(node);
      await this.#checkpoint(active);
      this.#update(view);
    });
  }

  async addresses(label?: string): Promise<{ address: string; label: string }[]> {
    return this.#operation(async (active) => {
      const addresses = await active.engine.addresses(label);
      if (label !== undefined) await this.#checkpoint(active);
      return addresses;
    });
  }

  async exportBackup(): Promise<ArrayBuffer> {
    return this.#operation(async (active) => {
      await active.engine.stopSync();
      await this.#checkpoint(active);
      return active.vault.exportBackup();
    });
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.#operation(async (active) => {
      await active.engine.stopSync();
      const snapshot = await active.engine.snapshot();
      await active.vault.changePassword({ oldPassword, newPassword, snapshot });
    });
  }

  async startSync(): Promise<void> {
    await this.#operation(async (active) => {
      this.#update(await active.engine.startSync());
      this.#syncRequested = true;
      this.#schedulePoll(active);
    });
  }

  async stopSync(): Promise<void> {
    this.#syncRequested = false;
    clearTimeout(this.#poll);
    await this.#operation(async (active) => {
      this.#update(await active.engine.stopSync());
      await this.#checkpoint(active);
    });
  }

  async prepareSend(input: {
    address: string;
    amount: string;
    maximumFee: string;
  }): Promise<SendPreview> {
    return this.#operation(async (active) => {
      const preview = await active.sends.prepare(input);
      this.#update(await active.engine.view());
      return preview;
    });
  }

  async approveSend(id: string): Promise<void> {
    await this.#operation(async (active) => {
      this.#update(await active.sends.approve(id));
    });
  }

  async broadcastSend(id: string): Promise<void> {
    await this.#operation(async (active) => {
      const view = await active.sends.broadcast(id);
      this.#update(view);
      if (view.pending?.status === 'unknown') throw new WalletError('broadcast-unknown');
    });
  }

  async reconcileSend(): Promise<void> {
    await this.#operation(async (active) => {
      this.#update(await active.sends.reconcile());
    });
  }

  async cancelSend(id: string): Promise<void> {
    await this.#operation(async (active) => {
      this.#update(await active.sends.cancel(id));
    });
  }

  lock(): void {
    this.#syncRequested = false;
    clearTimeout(this.#poll);
    this.#starting?.abort();
    const active = this.#active;
    this.#active = undefined;
    this.#view = undefined;
    if (active) {
      active.abort.abort();
      active.engine.close();
      active.vault.close();
      active.idle.close();
      void active.exclusive.release().catch(() => {
        this.#notifyFailure();
      });
    }
    this.dispatchEvent(new Event('change'));
  }

  async #start(operation: StartOperation): Promise<void> {
    if (this.#active || this.#starting) throw new WalletError('session-busy');
    const abort = new AbortController();
    this.#starting = abort;
    const exclusive = new ExclusiveSession();
    let engine: WalletEngine | undefined;
    let vault: Vault | undefined;
    try {
      await exclusive.acquire(abort.signal);
      engine = new WalletEngine(abort.signal);
      const opened = await this.#initialize(operation, abort.signal);
      vault = opened.vault;
      const view =
        operation.kind === 'create'
          ? await engine.create(operation.seed, operation.restoreHeight)
          : await engine.open(opened.snapshot);
      if (abort.signal.aborted) throw new WalletError('wallet-locked');
      const active = {
        engine,
        vault,
        abort,
        exclusive,
        idle: new IdleLock(() => {
          this.lock();
        }),
        sends: new SendWorkflow(engine, vault),
      };
      this.#active = active;
      if (operation.kind !== 'open') await this.#checkpoint(active);
      this.#update(view);
    } catch (error) {
      abort.abort();
      engine?.close();
      vault?.close();
      this.#active?.idle.close();
      this.#active = undefined;
      await exclusive.release();
      throw error;
    } finally {
      this.#starting = undefined;
    }
  }

  async #initialize(
    operation: StartOperation,
    signal: AbortSignal,
  ): Promise<{ vault: Vault; snapshot: ArrayBuffer }> {
    switch (operation.kind) {
      case 'create':
        return {
          vault: await Vault.create(operation.password, { signal }),
          snapshot: new ArrayBuffer(0),
        };
      case 'open':
        return Vault.open(operation.password, { signal });
      case 'recover':
        return Vault.recoverPrevious(operation.password, { signal });
      case 'import':
        return Vault.importBackup(operation.envelope, operation.password, { signal });
    }
  }

  async #operation<Result>(execute: (active: UnlockedSession) => Promise<Result>): Promise<Result> {
    const active = this.#active;
    if (!active) throw new WalletError('wallet-locked');
    if (this.#busy) throw new WalletError('session-busy');
    this.#busy = true;
    try {
      const result = await execute(active);
      if (active.abort.signal.aborted) throw new WalletError('wallet-locked');
      return result;
    } catch (error) {
      if (fatalSessionFailure(error)) this.lock();
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async #checkpoint(active: UnlockedSession): Promise<void> {
    await active.vault.save(await active.engine.snapshot());
  }

  #update(view: WalletView): void {
    this.#view = view;
    this.dispatchEvent(new Event('change'));
  }

  #schedulePoll(active: UnlockedSession): void {
    clearTimeout(this.#poll);
    this.#poll = setTimeout(() => {
      void this.#pollSync(active).catch(() => {
        this.#notifyFailure();
      });
    }, 1000);
  }

  async #pollSync(active: UnlockedSession): Promise<void> {
    if (this.#active !== active) return;
    if (this.#busy) {
      this.#schedulePoll(active);
      return;
    }
    await this.#operation(async () => {
      let view = await active.engine.view();
      if (view.sync === 'waiting-node') {
        this.#update(view);
        this.#continueSync(view);
        return;
      }
      if (view.sync === 'syncing') {
        this.#update(view);
        this.#schedulePoll(active);
      } else {
        if (view.sync === 'synced' && view.pending?.hash) view = await active.sends.reconcile();
        else await this.#checkpoint(active);
        this.#update(view);
        this.#continueSync(view);
      }
    });
  }

  #continueSync(view: WalletView): void {
    if (!this.#syncRequested || view.sync === 'failed') return;
    this.#poll = setTimeout(
      () => {
        void this.startSync().catch(() => {
          this.#notifyFailure();
        });
      },
      view.sync === 'offline' ? 100 : 30_000,
    );
  }

  #notifyFailure(): void {
    this.dispatchEvent(new Event('operationfailed'));
  }
}

function fatalSessionFailure(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return [
    'worker-closed',
    'worker-failed',
    'worker-protocol',
    'worker-timeout',
    'password-changed-locked',
    'engine-native-fatal',
  ].includes(String(error.code));
}
