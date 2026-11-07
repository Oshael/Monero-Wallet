// Test-only capture stays in the disposable browser and never exports wallet secrets.
export class EgressCapture {
  readonly #original = globalThis.fetch;
  readonly #requests: Uint8Array[] = [];
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
    this.#requests.push(metadata, body);
    return this.#original.call(globalThis, input, init);
  }

  assertSecretsAbsent(secrets: string[]): void {
    if (this.#requests.length === 0) throw new Error('Egress fixture observed no requests.');
    for (const secret of secrets) {
      for (const needle of secretEncodings(secret)) {
        if (this.#requests.some((request) => contains(request, needle)))
          throw new Error('A private canary reached an outgoing request.');
      }
    }
  }

  close(): void {
    globalThis.fetch = this.#original;
    for (const request of this.#requests) request.fill(0);
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
