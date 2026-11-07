import type { WalletEngine } from '../engine/index.ts';
import type { Vault } from '../vault/index.ts';
import { createIntent } from '../transactions/index.ts';
import type { SendPreview } from '../transactions/index.ts';
import type { WalletView } from '../domain/wallet-view.ts';

export class SendWorkflow {
  readonly #engine: Pick<WalletEngine, 'prepareSend' | 'transfer' | 'snapshot'>;
  readonly #vault: Pick<Vault, 'save'>;

  constructor(
    engine: Pick<WalletEngine, 'prepareSend' | 'transfer' | 'snapshot'>,
    vault: Pick<Vault, 'save'>,
  ) {
    this.#engine = engine;
    this.#vault = vault;
  }

  async prepare(input: {
    address: string;
    amount: string;
    maximumFee: string;
  }): Promise<SendPreview> {
    const preview = await this.#engine.prepareSend(createIntent(input));
    await this.#checkpoint();
    return preview;
  }

  async approve(id: string): Promise<WalletView> {
    const view = await this.#engine.transfer({ kind: 'approve-send', id });
    await this.#checkpoint();
    return view;
  }

  async broadcast(id: string): Promise<WalletView> {
    await this.#engine.transfer({ kind: 'arm-send', id });
    await this.#checkpoint();
    const view = await this.#engine.transfer({ kind: 'broadcast-send', id });
    await this.#checkpoint();
    return view;
  }

  async reconcile(): Promise<WalletView> {
    const view = await this.#engine.transfer({ kind: 'reconcile-send' });
    await this.#checkpoint();
    return view;
  }

  async cancel(id: string): Promise<WalletView> {
    const view = await this.#engine.transfer({ kind: 'cancel-send', id });
    await this.#checkpoint();
    return view;
  }

  async #checkpoint(): Promise<void> {
    await this.#vault.save(await this.#engine.snapshot());
  }
}
