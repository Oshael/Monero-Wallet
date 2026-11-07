import { VaultError } from './errors.ts';

const MAGIC = new TextEncoder().encode('XMRVAULT');
export const HEADER_BYTES = 52;
export const MAX_PAYLOAD_BYTES = 128 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = HEADER_BYTES + MAX_PAYLOAD_BYTES + 16;
export const KDF = Object.freeze({ logN: 17, r: 8, p: 1 });

export interface ParsedEnvelope {
  header: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

export function createHeader(salt: Uint8Array, nonce: Uint8Array): Uint8Array<ArrayBuffer> {
  if (salt.byteLength !== 16 || nonce.byteLength !== 12) throw new VaultError('invalid-format');
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set(MAGIC);
  view.setUint16(8, 1);
  view.setUint16(10, HEADER_BYTES);
  view.setUint32(12, KDF.logN);
  view.setUint32(16, KDF.r);
  view.setUint32(20, KDF.p);
  header.set(salt, 24);
  header.set(nonce, 40);
  return header;
}

function validateHeader(bytes: Uint8Array<ArrayBuffer>): void {
  if (!MAGIC.every((value, index) => bytes[index] === value)) {
    throw new VaultError('invalid-format');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
  const supported =
    view.getUint16(8) === 1 &&
    view.getUint16(10) === HEADER_BYTES &&
    view.getUint32(12) === KDF.logN &&
    view.getUint32(16) === KDF.r &&
    view.getUint32(20) === KDF.p;
  if (!supported) throw new VaultError('unsupported-format');
}

export function parseEnvelope(envelope: ArrayBuffer): ParsedEnvelope {
  if (envelope.byteLength > MAX_ENVELOPE_BYTES) {
    throw new VaultError('too-large');
  }
  if (envelope.byteLength < HEADER_BYTES + 16) throw new VaultError('invalid-format');
  const bytes = new Uint8Array(envelope);
  validateHeader(bytes);
  return {
    header: bytes.slice(0, HEADER_BYTES),
    salt: bytes.slice(24, 40),
    nonce: bytes.slice(40, HEADER_BYTES),
    ciphertext: bytes.slice(HEADER_BYTES),
  };
}
