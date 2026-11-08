import type { WalletEngine } from '../engine/index.ts';
import type { Vault } from '../vault/index.ts';
import type { WalletView } from '../domain/wallet-view.ts';

// Durable local intent and server authorization precede every consequential call.
export class LightDeletionWorkflow {
  readonly #engine: Pick<
    WalletEngine,
    'requestLightDeletion' | 'prepareLightDeletion' | 'finishLightDeletion' | 'snapshot'
  >;
  readonly #vault: Pick<Vault, 'save'>;

  constructor(
    engine: Pick<
      WalletEngine,
      'requestLightDeletion' | 'prepareLightDeletion' | 'finishLightDeletion' | 'snapshot'
    >,
    vault: Pick<Vault, 'save'>,
  ) {
    this.#engine = engine;
    this.#vault = vault;
  }

  async request(): Promise<WalletView> {
    await this.#engine.requestLightDeletion();
    await this.#checkpoint();
    return this.retry();
  }

  async retry(): Promise<WalletView> {
    let view = await this.#engine.prepareLightDeletion();
    // Also re-establish durability after a previous save failed in this session.
    await this.#checkpoint();
    const previousCount = view.lightService?.pendingDeletions ?? 0;
    const deadline = Date.now() + 60_000;
    for (let batch = 0; batch < 16 && Date.now() < deadline; batch++) {
      view = await this.#engine.finishLightDeletion();
      if (view.lightService?.pendingDeletions !== previousCount) {
        await this.#checkpoint();
        break;
      }
    }
    return view;
  }

  async #checkpoint(): Promise<void> {
    await this.#vault.save(await this.#engine.snapshot());
  }
}
