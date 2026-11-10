import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { ripemd160 as nobleRipemd160 } from '@noble/hashes/legacy.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

/**
 * The SDK's hashing and secp256k1 primitives, on @noble (audited, no
 * dependencies, the library bitcoinjs-lib and bip32 already use). Replaces
 * crypto-js and elliptic behind the same outputs: every address, hash and
 * signature is pinned by the compat golden vectors.
 */

/** secp256k1's group order n. */
export const SECP256K1_ORDER = secp256k1.CURVE.n;

/**
 * UTF-8 bytes of `text`, as crypto-js hashed a string. Like crypto-js
 * (which went through encodeURIComponent), text that is not valid UTF-16 (a
 * lone surrogate) throws a URIError instead of hashing a replacement
 * character.
 */
export function utf8Bytes(text: string): Uint8Array {
  encodeURIComponent(text);
  return new TextEncoder().encode(text);
}

/** SHA-256 of bytes, or of a string's UTF-8 encoding. */
export function sha256(data: Uint8Array | string): Uint8Array {
  return nobleSha256(typeof data === 'string' ? utf8Bytes(data) : data);
}

/** SHA-256 as lower-case hex. */
export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(data));
}

export function ripemd160(data: Uint8Array): Uint8Array {
  return nobleRipemd160(data);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(nobleSha256, key, data);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

/** Even-length hex (no prefix) to bytes; throws on anything else. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`Invalid hex: ${hex.length > 16 ? `${hex.slice(0, 16)}…` : hex}`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/**
 * A private key's scalar as 32 bytes. Taken modulo n, as elliptic's
 * keyFromPrivate did, so a key of any width (a 66-character key that is not
 * "00…", say) gives the same public key and signatures as before.
 */
function privateScalar(privateKey: Uint8Array): Uint8Array {
  const scalar = BigInt('0x' + (bytesToHex(privateKey) || '0')) % SECP256K1_ORDER;
  if (scalar === BigInt(0)) {
    throw new Error('Invalid private key: zero modulo the curve order');
  }
  return hexToBytes(scalar.toString(16).padStart(64, '0'));
}

/** The uncompressed public key (65 bytes, 04…) of a private key. */
export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateScalar(privateKey), false);
}

/**
 * ECDSA over a 32-byte digest: RFC 6979 deterministic nonce, low-S, DER.
 * The same bytes elliptic's `sign(digest, { canonical: true }).toDER()` gave.
 */
export function signDigestDer(digest: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return secp256k1.sign(digest, privateScalar(privateKey), { lowS: true, prehash: false }).toDERRawBytes();
}

/**
 * Whether (r, s) is a valid signature of a 32-byte digest by an
 * uncompressed or compressed public key. High-S signatures are accepted, as
 * elliptic accepted them: other wallets and Core may produce them.
 */
export function verifyDigest(digest: Uint8Array, r: bigint, s: bigint, publicKey: Uint8Array): boolean {
  try {
    return secp256k1.verify(new secp256k1.Signature(r, s), digest, publicKey, { lowS: false, prehash: false });
  } catch {
    return false;
  }
}

/** A fresh private key from the CSPRNG, valid on the curve. */
export function randomPrivateKey(): Uint8Array {
  return secp256k1.utils.randomPrivateKey();
}

/** The uncompressed ECDH shared point (65 bytes): ECIES' `sharedPoint`. */
export function sharedPoint(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return secp256k1.getSharedSecret(privateScalar(privateKey), publicKey, false);
}

/** A public key in any encoding as uncompressed 65 bytes; throws if it is not on the curve. */
export function uncompressedPublicKey(publicKey: Uint8Array): Uint8Array {
  return secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
}
