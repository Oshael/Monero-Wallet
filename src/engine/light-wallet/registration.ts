import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../../domain/validation.ts';
import { MAXIMUM_SCANNER_DELETIONS } from '../../domain/light-service.ts';
import type { LightServiceView } from '../../domain/light-service.ts';
import { LightWalletDeletionClient } from './deletion-client.ts';
import { scannerUri } from './registration-settings.ts';
import type { LightRegistrationSettings, ScannerDeletionIntent } from './registration-settings.ts';
import type { LightWalletSettings } from './settings.ts';

type KeySource = Pick<CandidateWallet, 'getPrimaryAddress' | 'getPrivateViewKey'>;
type Selection = Pick<LightWalletSettings, 'uri' | 'registration'>;

export class LightWalletRegistration {
  readonly #wallet: KeySource;
  readonly #network: 'stagenet' | 'mainnet';
  #uri: string | null;
  #state: LightRegistrationSettings;
  #tracked: boolean;
  #busy = false;

  constructor(wallet: KeySource, network: 'stagenet' | 'mainnet', settings: Selection) {
    this.#wallet = wallet;
    this.#network = network;
    this.#uri = settings.uri;
    this.#tracked = settings.registration !== undefined;
    this.#state = structuredClone(
      settings.registration ?? { phase: 'connected', current: null, pending: [] },
    );
  }

  checkpoint(): Selection {
    return {
      uri: this.#uri,
      ...(this.#tracked ? { registration: structuredClone(this.#state) } : {}),
    };
  }

  view(): LightServiceView {
    return {
      uri: this.#uri,
      phase: this.#state.phase,
      pendingDeletions: this.#state.pending.length,
      deletionOrigins: [
        ...new Set(this.#state.pending.map((intent) => new URL(intent.uri).origin)),
      ],
    };
  }

  assertSelectable(uri: string): void {
    this.#idle();
    const selected = scannerUri(uri);
    if (this.#state.pending.some((intent) => intent.uri === selected)) {
      throw new WalletError('scanner-deletion-pending');
    }
  }

  select(uri: string): void {
    this.assertSelectable(uri);
    this.#uri = scannerUri(uri);
    this.#state.phase = 'connected';
    this.#state.current = null;
    // Explicit fresh consent permits registration; earlier intents stay recoverable.
  }

  syncUri(): string {
    this.#idle();
    if (this.#state.phase !== 'connected') throw new WalletError('light-registration-disabled');
    if (!this.#uri) throw new WalletError('light-service-required');
    return this.#uri;
  }

  requestDeletion(): void {
    this.#idle();
    if (!this.#uri) throw new WalletError('light-service-required');
    if (this.#state.phase === 'deleting') return;
    if (this.#state.pending.length >= MAXIMUM_SCANNER_DELETIONS) {
      throw new WalletError('too-many-scanner-deletions');
    }
    const id = crypto.randomUUID();
    this.#state.pending.push({ id, uri: this.#uri, token: null });
    this.#state.phase = 'deleting';
    this.#state.current = id;
    this.#tracked = true;
  }

  async prepareNext(): Promise<void> {
    const intent = this.#next();
    if (intent.token !== null) return;
    intent.token = await this.#request(intent, (client) => client.prepare());
  }

  async finishNext(): Promise<void> {
    const intent = this.#next();
    const token = intent.token;
    if (token === null) throw new WalletError('scanner-deletion-not-prepared');
    const complete = await this.#request(intent, (client) => client.finish(token));
    if (!complete) return;
    this.#state.pending = this.#state.pending.filter((entry) => entry.id !== intent.id);
    if (this.#state.current === intent.id) {
      this.#state.current = null;
      this.#state.phase = 'deleted';
    }
  }

  #next(): ScannerDeletionIntent {
    this.#idle();
    const intent = this.#state.pending.at(-1);
    if (!intent) throw new WalletError('no-pending-scanner-deletion');
    return intent;
  }

  #idle(): void {
    if (this.#busy) throw new WalletError('light-registration-busy');
  }

  async #request<T>(
    intent: ScannerDeletionIntent,
    operation: (client: LightWalletDeletionClient) => Promise<T>,
  ): Promise<T> {
    this.#idle();
    this.#busy = true;
    let client: LightWalletDeletionClient | undefined;
    try {
      client = new LightWalletDeletionClient({
        uri: intent.uri,
        network: this.#network,
        credentials: {
          address: await this.#wallet.getPrimaryAddress(),
          view_key: await this.#wallet.getPrivateViewKey(),
        },
      });
      return await operation(client);
    } finally {
      client?.dispose();
      this.#busy = false;
    }
  }
}
