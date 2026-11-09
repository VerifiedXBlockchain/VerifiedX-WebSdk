import EC from 'elliptic';
import { getSecureRandomBytes, normalizePrivateKey } from '../utils';
import { hkdfSha256 } from './keypair-service';

/**
 * VFX-SHH: a message inside an NFT's description (or its current evolve
 * stage's) that only one address can read. The wallet writes it as
 *
 *   VFX-SHH:<recipient address>
 *   <base64 ciphertext>
 *   /VFX-SHH
 *
 * (or `[VFX-SHH:<address>]{<data>}[/VFX-SHH]`, or the bracketed form on
 * separate lines). The ciphertext is ECIES over secp256k1 as Python eciespy
 * 0.4 and eciesjs 0.3 produce it: a 65-byte uncompressed ephemeral public
 * key, a 16-byte nonce, a 16-byte GCM tag, then the AES-256-GCM ciphertext,
 * keyed by HKDF-SHA256 (no salt, no info) over the ephemeral key followed by
 * the uncompressed ECDH point. Ported from the Flutter wallet's
 * vfx_shh_message.dart and vfx_shh_decryption_service.dart.
 */
export interface VfxShhMessage {
  recipientAddress: string;
  /** Base64 ciphertext, whitespace removed. */
  encryptedData: string;
  /** The whole marked-up block as it appears in the text. */
  rawMessage: string;
}

const secp256k1Curve = new EC.ec('secp256k1');

const EPHEMERAL_KEY_BYTES = 65;
const NONCE_BYTES = 16;
const TAG_BYTES = 16;
const HEADER_BYTES = EPHEMERAL_KEY_BYTES + NONCE_BYTES + TAG_BYTES;

// The wallet's three forms, in the order it tries them. Data may span lines
// and may carry literal "\n" sequences where a description escaped its
// breaks; base64 has neither, so both are removed from every form (the
// wallet leaves them in the braced form, which then fails to decode).
const VFX_SHH_FORMS: RegExp[] = [
  /VFX-SHH:([^\s\n\\]+)(?:\\n|\s*\n\s*)([A-Za-z0-9+/=\n\s\\]+?)(?:\\n|\s*\n\s*)\/VFX-SHH/im,
  /\[VFX-SHH:([^\]]+)\]\s*\{([^}]+)\}\s*\[\/VFX-SHH\]/i,
  /\[VFX-SHH:([^\]]+)\](?:\\n|\s*\n\s*)([A-Za-z0-9+/=\n\s\\]+?)(?:\\n|\s*\n\s*)\[\/VFX-SHH\]/im,
];

/** The VFX-SHH message in `text`, or null when there is none. */
export function parseVfxShhMessage(text: string): VfxShhMessage | null {
  if (!text) return null;
  for (const pattern of VFX_SHH_FORMS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const recipientAddress = match[1].trim();
    const encryptedData = match[2].trim().replace(/\\n/g, '').replace(/\s/g, '');
    if (recipientAddress && encryptedData) {
      return { recipientAddress, encryptedData, rawMessage: match[0] };
    }
  }
  return null;
}

/** Wrap ciphertext from `encryptVfxShh` in the wallet's markup, ready for a description. */
export function formatVfxShhMessage(recipientAddress: string, encryptedData: string): string {
  return `VFX-SHH:${recipientAddress}\n${encryptedData}\n/VFX-SHH`;
}

function subtleCrypto(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) {
    throw new Error('vfx-web-sdk: VFX-SHH needs Web Crypto (crypto.subtle), present in browsers and Node 20+');
  }
  return subtle;
}

function aesKeyFor(ephemeralPublicKey: Uint8Array, sharedPoint: Uint8Array): Uint8Array {
  return hkdfSha256(Uint8Array.from([...ephemeralPublicKey, ...sharedPoint]), new Uint8Array(0), new Uint8Array(0), 32);
}

/**
 * Decrypt VFX-SHH ciphertext (base64) with the recipient's private key (hex).
 * Throws when the data is malformed or the key is not the recipient's (the
 * GCM tag does not verify).
 */
export async function decryptVfxShh(encryptedBase64: string, privateKeyHex: string): Promise<string> {
  const bytes = Uint8Array.from(Buffer.from(encryptedBase64, 'base64'));
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`VFX-SHH ciphertext is too short: ${bytes.length} bytes, at least ${HEADER_BYTES} expected`);
  }
  const ephemeralPublicKey = bytes.subarray(0, EPHEMERAL_KEY_BYTES);
  const nonce = bytes.subarray(EPHEMERAL_KEY_BYTES, EPHEMERAL_KEY_BYTES + NONCE_BYTES);
  const tag = bytes.subarray(EPHEMERAL_KEY_BYTES + NONCE_BYTES, HEADER_BYTES);
  const ciphertext = bytes.subarray(HEADER_BYTES);

  let sharedPoint: Uint8Array;
  try {
    const ephemeral = secp256k1Curve.keyFromPublic(Buffer.from(ephemeralPublicKey)).getPublic();
    const privateKey = secp256k1Curve.keyFromPrivate(normalizePrivateKey(privateKeyHex.replace(/^0x/, '')), 'hex');
    sharedPoint = Uint8Array.from(ephemeral.mul(privateKey.getPrivate()).encode('array', false));
  } catch (e) {
    throw new Error(`VFX-SHH ephemeral key or private key is invalid: ${e instanceof Error ? e.message : String(e)}`);
  }

  const subtle = subtleCrypto();
  const key = await subtle.importKey('raw', aesKeyFor(ephemeralPublicKey, sharedPoint), 'AES-GCM', false, ['decrypt']);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: TAG_BYTES * 8 },
      key,
      Uint8Array.from([...ciphertext, ...tag]),
    );
  } catch {
    throw new Error("VFX-SHH message did not decrypt: the key is not the recipient's, or the data is corrupt");
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}

/**
 * Encrypt `plaintext` for the holder of `recipientPublicKeyHex` (compressed
 * or uncompressed secp256k1), in the format `decryptVfxShh` and the Flutter
 * wallet read. Returns base64; wrap it with `formatVfxShhMessage`.
 */
export async function encryptVfxShh(recipientPublicKeyHex: string, plaintext: string): Promise<string> {
  const recipient = secp256k1Curve.keyFromPublic(recipientPublicKeyHex.replace(/^0x/, ''), 'hex').getPublic();
  const ephemeral = secp256k1Curve.genKeyPair({ entropy: Array.from(getSecureRandomBytes(32)) });
  const ephemeralPublicKey = Uint8Array.from(ephemeral.getPublic().encode('array', false));
  const sharedPoint = Uint8Array.from(recipient.mul(ephemeral.getPrivate()).encode('array', false));
  const nonce = getSecureRandomBytes(NONCE_BYTES);

  const subtle = subtleCrypto();
  const key = await subtle.importKey('raw', aesKeyFor(ephemeralPublicKey, sharedPoint), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: TAG_BYTES * 8 },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  return Buffer.from(Uint8Array.from([...ephemeralPublicKey, ...nonce, ...tag, ...ciphertext])).toString('base64');
}
