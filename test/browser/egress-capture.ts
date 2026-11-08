// Test-only capture stays in the disposable browser and never exports wallet secrets.
interface CapturedRequest {
  uri: string;
  metadata: Uint8Array;
  body: Uint8Array;
}

export class EgressCapture {
  readonly #original = globalThis.fetch;
  readonly #requests: CapturedRequest[] = [];
  #bytes = 0;

  constructor() {
    globalThis.fetch = (input, init) => this.#capture(input, init);
  }

  async #capture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input.clone() : new Request(input, init);
    const metadata = new TextEncoder().encode(
      request.url + '\n' + Array.from(request.headers.entries()).join('\n'),
    );
    const body = new Uint8Array(await request.clone().arrayBuffer());
    this.#bytes += metadata.byteLength + body.byteLength;
    if (this.#bytes > 16 * 1024 * 1024 || this.#requests.length >= 2048)
      throw new Error('Egress fixture budget exceeded.');
    this.#requests.push({ uri: request.url, metadata, body });
    return this.#original.call(globalThis, input, init);
  }

  assertSecretsAbsent(secrets: string[]): void {
    if (this.#requests.length === 0) throw new Error('Egress fixture observed no requests.');
    for (const secret of secrets) {
      for (const needle of secretEncodings(secret)) {
        if (
          this.#requests.some(
            (request) => contains(request.metadata, needle) || contains(request.body, needle),
          )
        )
          throw new Error('A private canary reached an outgoing request.');
      }
    }
  }

  assertSecretRestricted(secret: string, allowedUris: string[]): void {
    let shared = false;
    for (const request of this.#requests) {
      for (const needle of secretEncodings(secret)) {
        if (contains(request.metadata, needle)) throw new Error('Private canary in metadata.');
        if (!contains(request.body, needle)) continue;
        if (!allowedUris.includes(request.uri))
          throw new Error('Private canary at wrong endpoint.');
        shared = true;
      }
    }
    if (!shared) throw new Error('Expected private canary was not observed.');
  }

  mark(): number {
    return this.#requests.length;
  }

  assertNoRequestsSince(mark: number, paths: string[]): void {
    if (!Number.isSafeInteger(mark) || mark < 0 || mark > this.#requests.length) {
      throw new Error('Invalid egress fixture mark.');
    }
    if (
      this.#requests.slice(mark).some((request) => paths.includes(new URL(request.uri).pathname))
    ) {
      throw new Error('Unexpected chain scan request.');
    }
  }

  close(): void {
    globalThis.fetch = this.#original;
    for (const request of this.#requests) {
      request.metadata.fill(0);
      request.body.fill(0);
    }
    this.#requests.length = 0;
  }
}

function secretEncodings(secret: string): Uint8Array[] {
  const encoder = new TextEncoder();
  const variants = [encoder.encode(secret), encoder.encode(encodeURIComponent(secret))];
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    variants.push(encoder.encode(secret.toUpperCase()));
    variants.push(Uint8Array.from(secret.match(/../g) ?? [], (pair) => parseInt(pair, 16)));
  }
  return variants;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (!needle.length) throw new Error('Empty private canary.');
  return haystack.some(
    (byte, offset) =>
      byte === needle[0] && needle.every((value, index) => haystack[offset + index] === value),
  );
}
