import base58 from 'bs58';
import CryptoJS from 'crypto-js';
import KeypairService from './services/keypair-service';
import { Keypair } from './types';

/**
 * An external signing authority — an HSM, an MPC service, a hardware wallet,
 * or any process that holds the private key and must never hand it to the SDK.
 *
 * Every message the SDK needs signed (a transaction hash, a ceremony message)
 * is hashed with SHA-256 exactly as `KeypairService.getSignature` does, and the
 * 32-byte digest is passed to `signDigest`. The signer returns a plain
 * DER-encoded secp256k1 ECDSA signature over that digest — the format every
 * KMS and HSM emits natively — and the SDK assembles the network's signature
 * string (`base64(DER).base58(publicKey)`) from it.
 *
 * High-s signatures are normalised to low-s before use, so a signer that does
 * not canonicalise (AWS KMS, for one) works unchanged.
 */
export interface Signer {
  /** The VFX address the signature will be verified against. */
  address: string;
  /** Uncompressed secp256k1 public key as hex, with or without the `04` prefix. */
  publicKey: string;
  /**
   * Sign the SHA-256 digest of a message. `digestHex` is the 32-byte digest as
   * 64 hex characters. Return the DER signature as bytes, hex, or base64.
   */
  signDigest(digestHex: string): Promise<Uint8Array | string> | Uint8Array | string;
}

/** Anything the SDK can sign with: a local keypair or an external signer. */
export type KeypairOrSigner = Keypair | Signer;

/**
 * What every signing path inside the SDK works against once the caller's
 * input has been resolved. `publicKey` is always without the `04` prefix,
 * which is the form the API's `public_key` fields and the signature suffix use.
 */
export interface ResolvedSigner {
  address: string;
  publicKey: string;
  sign(message: string): Promise<string>;
}

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const SECP256K1_HALF_N = SECP256K1_N >> BigInt(1);

export function isSigner(value: unknown): value is Signer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Signer).signDigest === 'function' &&
    typeof (value as Signer).address === 'string' &&
    typeof (value as Signer).publicKey === 'string'
  );
}

/**
 * Normalise an uncompressed public key to 128 hex characters (no `04`).
 * Throws on anything that is not a 64-byte uncompressed secp256k1 point.
 */
export function stripPublicKeyPrefix(publicKeyHex: string): string {
  const hex = publicKeyHex.trim().toLowerCase();
  const body = hex.length === 130 && hex.startsWith('04') ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{128}$/.test(body)) {
    throw new Error(
      `Invalid public key: expected an uncompressed secp256k1 key (128 hex chars, optional 04 prefix), got ${hex.length} chars`,
    );
  }
  return body;
}

export function sha256Hex(message: string): string {
  return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex.length === 0 ? BigInt(0) : BigInt('0x' + hex);
}

function bigIntToDerInteger(value: bigint): number[] {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) {
    hex = '0' + hex;
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  // DER integers are signed: a leading byte with the high bit set needs a
  // 0x00 pad so the value is not read as negative.
  if (bytes[0] & 0x80) {
    bytes.unshift(0x00);
  }
  return bytes;
}

/**
 * Parse a DER-encoded ECDSA signature into its (r, s) scalars. Strict: the
 * sequence must be exactly two positive integers in range for secp256k1 with
 * nothing trailing. secp256k1 signatures are at most 72 bytes, so long-form
 * lengths are rejected rather than parsed.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = 0;
  const readByte = (): number => {
    if (offset >= der.length) {
      throw new Error('Invalid DER signature: unexpected end of data');
    }
    return der[offset++];
  };
  const readLength = (): number => {
    const length = readByte();
    if (length & 0x80) {
      throw new Error('Invalid DER signature: long-form length is not valid for secp256k1');
    }
    return length;
  };
  const readInteger = (label: string): bigint => {
    if (readByte() !== 0x02) {
      throw new Error(`Invalid DER signature: expected INTEGER tag for ${label}`);
    }
    const length = readLength();
    if (length === 0 || offset + length > der.length) {
      throw new Error(`Invalid DER signature: bad length for ${label}`);
    }
    const value = bytesToBigInt(der.subarray(offset, offset + length));
    offset += length;
    if (value <= BigInt(0) || value >= SECP256K1_N) {
      throw new Error(`Invalid DER signature: ${label} is out of range for secp256k1`);
    }
    return value;
  };

  if (readByte() !== 0x30) {
    throw new Error('Invalid DER signature: expected SEQUENCE tag');
  }
  const sequenceLength = readLength();
  if (sequenceLength !== der.length - 2) {
    throw new Error('Invalid DER signature: sequence length does not match data');
  }
  const r = readInteger('r');
  const s = readInteger('s');
  if (offset !== der.length) {
    throw new Error('Invalid DER signature: trailing bytes');
  }
  return { r, s };
}

export function encodeDerSignature(r: bigint, s: bigint): Uint8Array {
  const rBytes = bigIntToDerInteger(r);
  const sBytes = bigIntToDerInteger(s);
  const body = [0x02, rBytes.length, ...rBytes, 0x02, sBytes.length, ...sBytes];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/**
 * Decode a signer's raw return value into DER bytes. Hex is recognised by
 * its character set and even length; DER always begins with 0x30, and the
 * base64 of any DER signature begins with "M", which is not a hex digit, so
 * the two forms cannot be confused.
 */
export function derSignatureToBytes(raw: Uint8Array | string): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Signer returned an empty signature');
  }
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(trimmed, 'hex'));
  }
  return Uint8Array.from(Buffer.from(trimmed, 'base64'));
}

/**
 * Assemble the network signature string from a DER signature and the
 * signer's public key: `base64(canonical DER).base58(publicKey)`. The s
 * value is forced low, matching what `KeypairService.getSignature` produces
 * and what the node's verifier accepts.
 */
export function vfxSignatureFromDer(der: Uint8Array | string, publicKeyHex: string): string {
  const { r, s } = parseDerSignature(derSignatureToBytes(der));
  const canonicalS = s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
  const canonicalDer = encodeDerSignature(r, canonicalS);
  const signatureBase64 = Buffer.from(canonicalDer).toString('base64');
  const publicKey = stripPublicKeyPrefix(publicKeyHex);
  return `${signatureBase64}.${base58.encode(Buffer.from(publicKey, 'hex'))}`;
}

/**
 * Resolve a caller-supplied keypair, bare private key, or external signer
 * into one object the SDK signs with.
 *
 * The address is always derived from the key and checked against what the
 * caller supplied: a keypair or signer whose address does not belong to its
 * key would produce transactions the node rejects, and a mismatch usually
 * means the wrong key (or the wrong network) was wired up.
 */
export function resolveSigner(
  input: KeypairOrSigner | { privateKey: string },
  keypairService: KeypairService,
): ResolvedSigner {
  if (isSigner(input)) {
    const publicKey = stripPublicKeyPrefix(input.publicKey);
    const derivedAddress = keypairService.addressFromPublic(publicKey);
    if (input.address !== derivedAddress) {
      throw new Error(
        `Signer address ${input.address} does not match its public key (which derives ${derivedAddress} on this network)`,
      );
    }
    const signDigest = input.signDigest.bind(input);
    return {
      address: derivedAddress,
      publicKey,
      sign: async (message: string): Promise<string> => {
        const raw = await signDigest(sha256Hex(message));
        return vfxSignatureFromDer(raw, publicKey);
      },
    };
  }

  const privateKey = (input as { privateKey?: string }).privateKey;
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw new Error('A keypair with a privateKey or a Signer with signDigest() is required');
  }
  const address = keypairService.addressFromPrivate(privateKey);
  const suppliedAddress = (input as { address?: string }).address;
  if (suppliedAddress && suppliedAddress !== address) {
    throw new Error(
      `Keypair address ${suppliedAddress} does not match its private key (which derives ${address} on this network)`,
    );
  }
  return {
    address,
    publicKey: stripPublicKeyPrefix(keypairService.publicFromPrivate(privateKey)),
    sign: async (message: string): Promise<string> => keypairService.getSignature(message, privateKey),
  };
}
