import CryptoJS from 'crypto-js';
import base58 from 'bs58';
import * as secp256k1 from '@noble/secp256k1';
import * as bip39 from 'bip39';
import {
  arrayToHex,
  byteArrayToWordArray,
  concatArrays,
  hexStringToByteArray,
  hexToString,
  isValidPrivateKey,
  normalizePrivateKey,
  wordArrayToByteArray,
} from '../utils';
import { Network } from '../../constants';

// Browser-compatible Buffer polyfill
const BufferPolyfill = {
  from: (data: string | Uint8Array, encoding?: string): Uint8Array => {
    if (typeof data === 'string') {
      if (encoding === 'hex') {
        return new Uint8Array(data.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
      }
      return new TextEncoder().encode(data);
    }
    return data;
  },
  toString: (buffer: Uint8Array, encoding: string): string => {
    if (encoding === 'hex') {
      return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (encoding === 'base64') {
      return btoa(String.fromCharCode(...buffer));
    }
    return new TextDecoder().decode(buffer);
  }
};

export class BrowserKeypairService {
  network: Network;

  constructor(network: Network) {
    this.network = network;
  }

  public generatePrivateKey(): string {
    let privateKey: CryptoJS.lib.WordArray;

    do {
      privateKey = CryptoJS.lib.WordArray.random(32);
    } while (!isValidPrivateKey(privateKey));

    // Prepend 00 for CLI BigInteger compatibility
    return '00' + privateKey.toString(CryptoJS.enc.Hex);
  }

  public generateMnemonic(words: 12 | 24 = 12): string {
    return bip39.generateMnemonic(words == 12 ? 128 : 256);
  }

  public privateKeyFromMnemonic(mnemonic: string, index: number): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    // Use WebCrypto API for HD key derivation (simplified for browser)
    // Note: This is a simplified implementation. For full BIP32 support,
    // you might want to use @scure/bip32 which is browser-compatible
    const seedArray = new Uint8Array(seed);

    // Simple deterministic derivation based on index
    const indexBytes = new Uint8Array(4);
    indexBytes[0] = (index >>> 24) & 0xff;
    indexBytes[1] = (index >>> 16) & 0xff;
    indexBytes[2] = (index >>> 8) & 0xff;
    indexBytes[3] = index & 0xff;

    const combined = new Uint8Array(seedArray.length + indexBytes.length);
    combined.set(seedArray);
    combined.set(indexBytes, seedArray.length);

    const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(Array.from(combined)));
    // Prepend 00 for CLI BigInteger compatibility
    return '00' + hash.toString(CryptoJS.enc.Hex);
  }

  public privateKeyFromEmailPassword(email: string, password: string, index = 0): string {
    // Normalize email
    email = email.toLowerCase();

    // Create seed string with entropy
    let seed = `${email}|${password}|`;
    seed = `${seed}${seed.length}|!@${((password.length * 7) + email.length) * 7}`;

    // Fixed values for cross-platform wallet compatibility
    const chars = 1;
    const upperChars = 1;
    const numbers = 1;

    seed = `${seed}${(chars + upperChars + numbers) * password.length}3571`;
    seed = `${seed}${seed}`;

    // Hash the seed 50 times
    for (let i = 0; i <= 50; i++) {
      seed = CryptoJS.SHA256(seed).toString(CryptoJS.enc.Hex);
    }

    // For browser, we need to use a simplified approach since we don't have full BIP32
    // Convert the seed string to bytes (treating it as UTF-8, not hex)
    const seedBytes = new TextEncoder().encode(seed);

    // Simple deterministic derivation based on index
    const indexBytes = new Uint8Array(4);
    indexBytes[0] = (index >>> 24) & 0xff;
    indexBytes[1] = (index >>> 16) & 0xff;
    indexBytes[2] = (index >>> 8) & 0xff;
    indexBytes[3] = index & 0xff;

    const combined = new Uint8Array(seedBytes.length + indexBytes.length);
    combined.set(seedBytes);
    combined.set(indexBytes, seedBytes.length);

    const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(Array.from(combined)));
    const privateKey = hash.toString(CryptoJS.enc.Hex);

    // Validate private key
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(privateKey);
    if (!isValidPrivateKey(privateKeyWordArray)) {
      throw new Error('Generated private key is invalid');
    }

    // Prepend 00 for CLI BigInteger compatibility
    return '00' + privateKey;
  }

  public publicFromPrivate(privateKey: string): string {
    // Normalize to handle both 64 and 66 char formats
    const normalized = normalizePrivateKey(privateKey.toLowerCase());
    const privateKeyBytes = BufferPolyfill.from(normalized, 'hex');
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false); // uncompressed
    return BufferPolyfill.toString(publicKeyBytes, 'hex');
  }

  public addressFromPrivate(privateKey: string): string {
    // Normalize to handle both 64 and 66 char formats
    const normalized = normalizePrivateKey(privateKey.toLowerCase());
    const privateKeyBytes = BufferPolyfill.from(normalized, 'hex');
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false);
    const publicKeyHex = BufferPolyfill.toString(publicKeyBytes, 'hex');

    const pubKeySha = CryptoJS.SHA256(hexToString(publicKeyHex));
    const pubKeyShaRipe = CryptoJS.RIPEMD160(pubKeySha);

    const preHashWNetworkData = concatArrays([
      new Uint8Array(this.network == Network.Testnet ? [0x89] : [0x3c]),
      wordArrayToByteArray(pubKeyShaRipe),
    ]);

    const publicHash = CryptoJS.SHA256(byteArrayToWordArray(preHashWNetworkData));
    const publicHashHash = CryptoJS.SHA256(publicHash);
    const checksum = publicHashHash.toString(CryptoJS.enc.Hex).slice(0, 8);

    const address = `${arrayToHex(preHashWNetworkData)}${checksum}`;
    const base54Address = base58.encode(hexStringToByteArray(address));

    return base54Address;
  }

  public getSignature(message: string, privateKeyHex: string): string {
    // Normalize to handle both 64 and 66 char formats
    const normalized = normalizePrivateKey(privateKeyHex);

    const data = CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);

    const privateKey = BufferPolyfill.from(normalized, 'hex');
    const dataBytes = BufferPolyfill.from(data, 'hex');

    // Use @noble/secp256k1 for browser-compatible signing
    const signature = secp256k1.sign(dataBytes, privateKey);

    // Get DER encoded signature directly
    const derSignature = signature.toDERRawBytes ? signature.toDERRawBytes() : signature;
    const signatureBase64 = BufferPolyfill.toString(derSignature, 'base64');

    let publicKeyHex = this.publicFromPrivate(normalized);
    if (publicKeyHex.substring(0, 2) === '04') {
      publicKeyHex = publicKeyHex.substring(2);
    }

    const publicKeyBuffer = BufferPolyfill.from(publicKeyHex, 'hex');
    const publicKeyBufferBase58 = base58.encode(publicKeyBuffer);

    const fullSignature = `${signatureBase64}.${publicKeyBufferBase58}`;

    return fullSignature;
  }
}

export default BrowserKeypairService;