import { object, WalletError } from '../../domain/validation.ts';
import { boolean, hex } from './values.ts';
import { LightWalletTransport } from './transport.ts';
import { readLightServerVersion } from './protocol.ts';

interface Options {
  uri: string;
  network: 'stagenet' | 'mainnet';
  credentials: { address: string; view_key: string };
}

// This client never logs in or registers. One operation owns its credential copy.
export class LightWalletDeletionClient {
  readonly #transport: LightWalletTransport;
  readonly #network: Options['network'];
  #credentials: Options['credentials'] | undefined;
  readonly #timer: ReturnType<typeof setTimeout>;

  constructor(options: Options) {
    this.#transport = new LightWalletTransport(options.uri);
    this.#network = options.network;
    this.#credentials = { ...options.credentials, view_key: hex(options.credentials.view_key) };
    // Version validation plus the authenticated request fit the worker operation budget.
    this.#timer = setTimeout(() => {
      this.dispose();
    }, 20_000);
  }

  async prepare(): Promise<string> {
    await readLightServerVersion(this.#transport, this.#network);
    const result = object(
      await this.#transport.request('prepare_account_delete', { ...this.#active() }),
    );
    return hex(result.token);
  }

  async finish(token: string): Promise<boolean> {
    const authorization = hex(token);
    await readLightServerVersion(this.#transport, this.#network);
    const result = object(
      await this.#transport.request('delete_account', {
        ...this.#active(),
        token: authorization,
      }),
    );
    return boolean(result.complete);
  }

  dispose(): void {
    clearTimeout(this.#timer);
    this.#credentials = undefined;
    this.#transport.dispose();
  }

  #active(): Options['credentials'] {
    if (!this.#credentials) throw new WalletError('light-client-closed');
    return this.#credentials;
  }
}
