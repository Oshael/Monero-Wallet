import { object, WalletError } from '../../domain/validation.ts';
import type { NodeChainStatus } from '../../domain/node-status.ts';
import { decodeLightWalletData, lightWalletProgress } from './data.ts';
import type { LightWalletData } from './data.ts';
import { boolean, hex, integer, unsigned } from './values.ts';
import { LightWalletTransport } from './transport.ts';
import { readLightServerVersion } from './protocol.ts';

interface Credentials {
  address: string;
  view_key: string;
}

interface Options {
  uri: string;
  network: 'stagenet' | 'mainnet';
  restoreHeight: number;
  credentials: Credentials;
  signal?: AbortSignal;
}

const lookahead = { maj_i: 1, min_i: 1000 };

// One scan owns one client. Disposing it aborts requests and drops its credentials.
export class LightWalletClient {
  readonly #transport: LightWalletTransport;
  readonly #signal: AbortSignal | undefined;
  readonly #abort = () => {
    this.dispose();
  };
  #credentials: Credentials | undefined;
  #progress: { height: number; targetHeight: number } | undefined;

  private constructor(options: Options) {
    this.#transport = new LightWalletTransport(options.uri);
    this.#credentials = {
      address: options.credentials.address,
      view_key: hex(options.credentials.view_key),
    };
    this.#signal = options.signal;
    if (this.#signal?.aborted) this.dispose();
    else this.#signal?.addEventListener('abort', this.#abort, { once: true });
  }

  static async open(options: Options): Promise<LightWalletClient> {
    const client = new LightWalletClient(options);
    try {
      await client.#register(options);
      return client;
    } catch (error) {
      client.dispose();
      throw error;
    }
  }

  async read(readNode: () => Promise<NodeChainStatus>): Promise<LightWalletData> {
    const credentials = this.#active();
    const info = await this.#transport.request('get_address_info', { ...credentials });
    const progress = lightWalletProgress(info, await readNode());
    this.#progress = { height: progress.height, targetHeight: progress.targetHeight };
    if (!progress.current) throw new WalletError('light-scanner-behind');
    const transactions = await this.#transport.request('get_address_txs', { ...credentials });
    const outputs = await this.#transport.request('get_unspent_outs', {
      ...credentials,
      amount: '0',
    });
    return decodeLightWalletData({ info, transactions, outputs, node: await readNode() });
  }

  dispose(): void {
    this.#transport.dispose();
    this.#signal?.removeEventListener('abort', this.#abort);
    this.#credentials = undefined;
  }

  get progress(): { height: number; targetHeight: number } | undefined {
    return this.#progress ? { ...this.#progress } : undefined;
  }

  #active(): Credentials {
    if (!this.#credentials) throw new WalletError('light-client-closed');
    return this.#credentials;
  }

  async #register(options: Options): Promise<void> {
    const version = await readLightServerVersion(this.#transport, options.network);
    // LWS counts provisioned addresses plus the lookahead beyond the last used index.
    if (integer(version.max_subaddresses) < 2 * lookahead.min_i) {
      throw new WalletError('light-subaddresses-unavailable');
    }
    const credentials = this.#active();
    const login = object(
      await this.#transport.request('login', {
        ...credentials,
        create_account: true,
        generated_locally: true,
        lookahead,
      }),
    );
    boolean(login.new_address);
    boolean(login.generated_locally);
    const imported = object(
      await this.#transport.request('import_wallet_request', {
        ...credentials,
        from_height: integer(options.restoreHeight),
        lookahead,
      }),
    );
    if (unsigned(imported.import_fee === undefined ? '0' : imported.import_fee) !== '0') {
      throw new WalletError('light-import-fee-unsupported');
    }
    boolean(imported.new_request);
    if (!boolean(imported.request_fulfilled)) {
      throw new WalletError('light-import-awaiting-approval');
    }
    const registered = object(imported.lookahead);
    if (integer(registered.maj_i) !== 1 || integer(registered.min_i) !== 1000) {
      throw new WalletError('light-subaddresses-unavailable');
    }
  }
}
