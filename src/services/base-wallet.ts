import CryptoJS from 'crypto-js';
import EC from 'elliptic';
import { arrayToHex, byteArrayToWordArray, hexStringToByteArray, wordArrayToByteArray } from '../utils';

/**
 * Base (EVM) account derivation, ported byte for byte from Bfly
 * (butterfly-web src/lib/baseWallet.ts). Changing anything here moves every
 * Bfly user's Base, Polygon and Polymarket funds to a different address.
 */

const secp256k1Curve = new EC.ec('secp256k1');

/** Keeps the EVM key apart from every other key derived from the VFX key. */
const BASE_DOMAIN_SEPARATOR = 'base-wallet-v1|';

const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

export interface BaseKeypair {
  /** EIP-55 checksummed address. */
  address: string;
  /** Uncompressed secp256k1 public key, `0x04` + 128 hex characters. */
  publicKey: string;
  /** EVM private key, `0x` + 64 hex characters. */
  privateKey: string;
}

/**
 * Bfly's key normalizer, kept as it is: strips one `0x`, then one `00` only
 * from a 66-character key, and accepts exactly 64 hex characters. Unlike
 * `normalizePrivateKey` it never pads a short key.
 */
function normalizeVfxPrivateKey(vfxPrivateKey: string): string {
  let normalized = vfxPrivateKey.startsWith('0x') ? vfxPrivateKey.slice(2) : vfxPrivateKey;
  if (normalized.startsWith('00') && normalized.length === 66) {
    normalized = normalized.slice(2);
  }
  if (normalized.length !== 64) {
    throw new Error(`Invalid VFX private key length: expected 64 hex characters, got ${normalized.length}`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Invalid VFX private key: must contain only hexadecimal characters');
  }
  return normalized;
}

function keccak256(bytes: Uint8Array): Uint8Array {
  // crypto-js 3.x SHA3 is the original Keccak padding, which is what Ethereum uses.
  return wordArrayToByteArray(CryptoJS.SHA3(byteArrayToWordArray(bytes), { outputLength: 256 }));
}

function toChecksumAddress(lowercaseHex: string): string {
  const hash = arrayToHex(keccak256(Uint8Array.from(Buffer.from(lowercaseHex, 'utf-8'))));
  let checksummed = '0x';
  for (let i = 0; i < lowercaseHex.length; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? lowercaseHex[i].toUpperCase() : lowercaseHex[i];
  }
  return checksummed;
}

/** The EVM account for a 32-byte private key (hex, no `0x`). Throws outside 1..n-1, as ethers does. */
export function evmAccountFromPrivateKey(privateKeyHex: string): BaseKeypair {
  const scalar = BigInt('0x' + privateKeyHex);
  if (scalar === BigInt(0) || scalar >= SECP256K1_ORDER) {
    throw new Error('EVM private key is outside the secp256k1 range');
  }
  const uncompressed = secp256k1Curve.keyFromPrivate(privateKeyHex, 'hex').getPublic(false, 'hex');
  const addressHex = arrayToHex(keccak256(hexStringToByteArray(uncompressed.slice(2))).slice(12));
  return {
    address: toChecksumAddress(addressHex),
    publicKey: '0x' + uncompressed,
    privateKey: '0x' + privateKeyHex,
  };
}

/**
 * The Base (EVM) account Bfly derives from a VFX private key:
 * SHA-256(utf8('base-wallet-v1|') || the 32 raw key bytes) is the EVM private
 * key. The same key gives the same account on every EVM chain and on both VFX
 * networks. Accepts the key as 64 hex characters, optionally prefixed with
 * `0x` and/or the CLI's `00`. Build an ethers `Wallet` from `privateKey` to sign.
 */
export async function deriveBaseKeypair(vfxPrivateKey: string): Promise<BaseKeypair> {
  const keyBytes = hexStringToByteArray(normalizeVfxPrivateKey(vfxPrivateKey));
  const separatorBytes = Uint8Array.from(Buffer.from(BASE_DOMAIN_SEPARATOR, 'utf-8'));
  const digest = CryptoJS.SHA256(byteArrayToWordArray(Uint8Array.from([...separatorBytes, ...keyBytes])));
  return evmAccountFromPrivateKey(arrayToHex(wordArrayToByteArray(digest)));
}
