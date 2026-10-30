import base58 from 'bs58';

/**
 * Parsing for the network signature string `base64(DER).base58(publicKey)`,
 * as verifiers read it. The rules are butterfly-service's
 * `verify_vfx_signature` (Python 3.12 base64, base58 2.1.1, ecdsa 0.19.1),
 * reproduced exactly so a signature the platform accepts is accepted here and
 * one it refuses is refused here. That is looser than what
 * `KeypairService.getSignature` produces: compressed, `04`-prefixed and
 * hybrid public keys, a public key missing its leading zero byte (63 bytes),
 * high-s values and non-canonical base64 are all accepted. The shared vectors
 * in the compat tests pin the two implementations together.
 */

const SECP256K1_P = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');
const SECP256K1_B = BigInt(7);

/** A signature string split into its parts; the point is checked to lie on secp256k1. */
export interface ParsedVfxSignature {
  r: bigint;
  s: bigint;
  /** The signer's public key, 128 hex characters (x then y), no `04` prefix. */
  publicKey: string;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]*$/;
// What Python's str.rstrip() removes: every code point for which str.isspace() is true.
const PYTHON_WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/** Split, decode and range-check a signature string; null when the platform would refuse it. */
export function parseVfxSignature(signature: string): ParsedVfxSignature | null {
  const dot = signature.indexOf('.');
  if (dot < 0) {
    return null;
  }
  const der = decodeBase64LikePython(signature.slice(0, dot));
  const publicKeyBytes = decodeBase58LikePython(signature.slice(dot + 1));
  if (!der || !publicKeyBytes) {
    return null;
  }
  const publicKey = decodePublicKey(publicKeyBytes);
  const rs = parseStrictDerSignature(der);
  if (!publicKey || !rs) {
    return null;
  }
  return { ...rs, publicKey };
}

/**
 * Python's `base64.b64decode(s)` (non-strict): characters outside the
 * alphabet are skipped, decoding stops at the first complete pad sequence,
 * and input that ends mid-quantum is an error. Null on error.
 */
export function decodeBase64LikePython(input: string): Uint8Array | null {
  // b64decode only takes ASCII strings, wherever the non-ASCII character is.
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) > 0x7f) {
      return null;
    }
  }
  const out: number[] = [];
  let quadPos = 0;
  let leftChar = 0;
  let pads = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '=') {
      if (quadPos >= 2 && quadPos + ++pads >= 4) {
        return Uint8Array.from(out);
      }
      continue;
    }
    const value = BASE64_ALPHABET.indexOf(ch);
    if (value < 0) {
      continue;
    }
    pads = 0;
    switch (quadPos) {
      case 0:
        leftChar = value;
        quadPos = 1;
        break;
      case 1:
        out.push(((leftChar << 2) | (value >> 4)) & 0xff);
        leftChar = value & 0x0f;
        quadPos = 2;
        break;
      case 2:
        out.push(((leftChar << 4) | (value >> 2)) & 0xff);
        leftChar = value & 0x03;
        quadPos = 3;
        break;
      default:
        out.push(((leftChar << 6) | value) & 0xff);
        leftChar = 0;
        quadPos = 0;
    }
  }
  return quadPos === 0 ? Uint8Array.from(out) : null;
}

/** Python base58 2.1.1's `b58decode`: trailing whitespace is stripped first. Null on error. */
export function decodeBase58LikePython(input: string): Uint8Array | null {
  let end = input.length;
  while (end > 0 && PYTHON_WHITESPACE.has(input.charCodeAt(end - 1))) {
    end--;
  }
  const trimmed = input.slice(0, end);
  if (!BASE58_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.length === 0 ? new Uint8Array(0) : base58.decode(trimmed);
}

/**
 * Decode a public key the way ecdsa's `VerifyingKey.from_string` does after
 * butterfly-service pads a 63-byte key with a zero byte: raw (64 bytes),
 * uncompressed (`04`), hybrid (`06`/`07`, parity checked) or compressed
 * (`02`/`03`). Returns x||y as 128 hex characters, or null when the bytes are
 * not a point on secp256k1.
 */
export function decodePublicKey(bytes: Uint8Array): string | null {
  // Keys whose x coordinate starts with a zero byte lose it when an encoder
  // treats the key as a number; the platform restores it.
  const key = bytes.length === 63 ? concatBytes(new Uint8Array([0]), bytes) : bytes;

  let x: bigint;
  let y: bigint;
  if (key.length === 64) {
    x = bytesToBigInt(key.subarray(0, 32));
    y = bytesToBigInt(key.subarray(32));
  } else if (key.length === 65) {
    const prefix = key[0];
    if (prefix !== 0x04 && prefix !== 0x06 && prefix !== 0x07) {
      return null;
    }
    x = bytesToBigInt(key.subarray(1, 33));
    y = bytesToBigInt(key.subarray(33));
    if (prefix !== 0x04 && (y & BigInt(1)) !== BigInt(prefix === 0x07 ? 1 : 0)) {
      return null;
    }
  } else if (key.length === 33) {
    const prefix = key[0];
    if (prefix !== 0x02 && prefix !== 0x03) {
      return null;
    }
    x = bytesToBigInt(key.subarray(1));
    const alpha = (modPow(x, BigInt(3), SECP256K1_P) + SECP256K1_B) % SECP256K1_P;
    // p ≡ 3 (mod 4), so the square root is alpha^((p+1)/4) when one exists.
    const beta = modPow(alpha, (SECP256K1_P + BigInt(1)) / BigInt(4), SECP256K1_P);
    if ((beta * beta) % SECP256K1_P !== alpha) {
      return null;
    }
    const wantOdd = prefix === 0x03;
    y = (beta & BigInt(1)) === BigInt(wantOdd ? 1 : 0) ? beta : SECP256K1_P - beta;
  } else {
    return null;
  }

  if (x >= SECP256K1_P || y >= SECP256K1_P) {
    return null;
  }
  if ((y * y - (x * x * x + SECP256K1_B)) % SECP256K1_P !== BigInt(0)) {
    return null;
  }
  return x.toString(16).padStart(64, '0') + y.toString(16).padStart(64, '0');
}

/**
 * ecdsa's `sigdecode_der`: a SEQUENCE of exactly two non-negative, minimally
 * encoded INTEGERs and nothing after it. Range against the group order is the
 * verifier's job, not the parser's. Null when malformed.
 */
export function parseStrictDerSignature(der: Uint8Array): { r: bigint; s: bigint } | null {
  const sequence = readTlv(der, 0x30);
  if (!sequence || sequence.rest.length !== 0) {
    return null;
  }
  const r = readInteger(sequence.body);
  if (!r) {
    return null;
  }
  const s = readInteger(r.rest);
  if (!s || s.rest.length !== 0) {
    return null;
  }
  return { r: r.value, s: s.value };
}

function readInteger(bytes: Uint8Array): { value: bigint; rest: Uint8Array } | null {
  const tlv = readTlv(bytes, 0x02);
  if (!tlv || tlv.body.length === 0) {
    return null;
  }
  const { body } = tlv;
  if (body[0] >= 0x80) {
    return null;
  }
  if (body.length > 1 && body[0] === 0 && body[1] < 0x80) {
    return null;
  }
  return { value: bytesToBigInt(body), rest: tlv.rest };
}

/** One DER tag-length-value with ecdsa's minimal-length rules. */
function readTlv(bytes: Uint8Array, tag: number): { body: Uint8Array; rest: Uint8Array } | null {
  if (bytes.length === 0 || bytes[0] !== tag || bytes.length < 2) {
    return null;
  }
  let length = bytes[1];
  let headerLength = 2;
  if (length & 0x80) {
    const lengthOfLength = length & 0x7f;
    if (lengthOfLength === 0 || lengthOfLength > bytes.length - 2) {
      return null;
    }
    const first = bytes[2];
    if (first === 0 || (lengthOfLength === 1 && first < 0x80)) {
      return null;
    }
    length = 0;
    for (let i = 0; i < lengthOfLength; i++) {
      length = length * 256 + bytes[2 + i];
    }
    headerLength = 2 + lengthOfLength;
  }
  if (length > bytes.length - headerLength) {
    return null;
  }
  return {
    body: bytes.subarray(headerLength, headerLength + length),
    rest: bytes.subarray(headerLength + length),
  };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex.length === 0 ? BigInt(0) : BigInt('0x' + hex);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = BigInt(1);
  let b = base % modulus;
  let e = exponent;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= BigInt(1);
  }
  return result;
}
