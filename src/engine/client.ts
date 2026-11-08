import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import type { WalletView } from '../domain/wallet-view.ts';
import { WorkerChannel } from '../runtime/worker-channel.ts';
import { decodeReply } from './messages.ts';
import type { EngineCommand, EngineReply } from './messages.ts';
import type { SendIntent, SendPreview } from '../transactions/index.ts';

export class WalletEngine {
  readonly #worker: WorkerChannel<EngineCommand, EngineReply>;

  constructor(signal: AbortSignal) {
    this.#worker = new WorkerChannel(
      new Worker(new URL('engine.worker.js', import.meta.url), { type: 'module' }),
      decodeReply,
      signal,
    );
  }

  async create(seed = '', restoreHeight = 0): Promise<WalletView> {
    return this.#view({ kind: 'create', seed, restoreHeight });
  }

  async open(snapshot: ArrayBuffer): Promise<WalletView> {
    return this.#view({ kind: 'open', snapshot }, [snapshot]);
  }

  async view(): Promise<WalletView> {
    return this.#view({ kind: 'view' });
  }

  async snapshot(): Promise<ArrayBuffer> {
    const reply = await this.#worker.call({ kind: 'snapshot' });
    if (reply.kind !== 'snapshot') throw new WalletError('invalid-reply');
    return reply.snapshot;
  }

  async seed(): Promise<string> {
    const reply = await this.#worker.call({ kind: 'seed' });
    if (reply.kind !== 'seed') throw new WalletError('invalid-reply');
    return reply.seed;
  }

  async verifySeed(seed: string): Promise<WalletView> {
    return this.#view({ kind: 'verify-seed', seed });
  }

  async connect(node: NodeConnection): Promise<WalletView> {
    return this.#view({ kind: 'node', node });
  }

  async connectLight(connection: { uri: string; node: NodeConnection }): Promise<WalletView> {
    return this.#view({ kind: 'light-service', ...connection });
  }

  async startSync(): Promise<WalletView> {
    return this.#view({ kind: 'start-sync' });
  }

  async stopSync(): Promise<WalletView> {
    return this.#view({ kind: 'stop-sync' });
  }

  async addresses(label?: string): Promise<{ address: string; label: string }[]> {
    const command: EngineCommand =
      label === undefined ? { kind: 'addresses' } : { kind: 'subaddress', label };
    const reply = await this.#worker.call(command);
    if (reply.kind !== 'addresses') throw new WalletError('invalid-reply');
    return reply.addresses;
  }

  close(): void {
    this.#worker.dispose();
  }

  async prepareSend(intent: SendIntent): Promise<SendPreview> {
    const reply = await this.#worker.call({ kind: 'prepare-send', intent });
    if (reply.kind !== 'send-preview') throw new WalletError('invalid-reply');
    return reply.preview;
  }

  async transfer(
    command: Extract<
      EngineCommand,
      { kind: 'approve-send' | 'arm-send' | 'broadcast-send' | 'cancel-send' | 'reconcile-send' }
    >,
  ): Promise<WalletView> {
    return this.#view(command);
  }

  async #view(command: EngineCommand, transfer: Transferable[] = []): Promise<WalletView> {
    const reply = await this.#worker.call(command, transfer);
    if (reply.kind !== 'view') throw new WalletError('invalid-reply');
    return reply.view;
  }
}
