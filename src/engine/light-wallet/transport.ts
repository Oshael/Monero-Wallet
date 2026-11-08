import { nodeConnection, WalletError } from '../../domain/validation.ts';

type Method =
  | 'get_version'
  | 'login'
  | 'import_wallet_request'
  | 'get_address_info'
  | 'get_address_txs'
  | 'get_unspent_outs';

export class LightWalletTransport {
  readonly #uri: string;
  readonly #lifetime = new AbortController();
  #busy = false;

  constructor(uri: string) {
    this.#uri = nodeConnection({ uri, username: '', password: '' }).uri;
  }

  async request(method: Method, body?: Record<string, unknown>): Promise<unknown> {
    if (this.#lifetime.signal.aborted) throw new WalletError('light-client-closed');
    if (this.#busy) throw new WalletError('light-client-busy');
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && encoded.length > 64 * 1024) throw new WalletError('light-request-too-large');
    this.#busy = true;
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    this.#lifetime.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15_000);
    try {
      return await requestJson(`${this.#uri}/${method}`, encoded, controller.signal);
    } catch (error) {
      if (error instanceof WalletError) throw error;
      throw new WalletError('light-server-unavailable');
    } finally {
      controller.abort();
      clearTimeout(timer);
      this.#lifetime.signal.removeEventListener('abort', abort);
      this.#busy = false;
    }
  }

  dispose(): void {
    this.#lifetime.abort();
  }
}

async function requestJson(
  uri: string,
  body: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(uri, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body }),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (response.status !== 200 || !response.body) throw new WalletError('light-server-unavailable');
  const declared = Number(response.headers.get('Content-Length') ?? 0);
  if (declared > 64 * 1024 * 1024) throw new WalletError('light-response-too-large');
  const bytes = await readBody(response.body);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

async function readBody(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 64 * 1024 * 1024 || chunks.length >= 4096) {
        throw new WalletError('light-response-too-large');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
