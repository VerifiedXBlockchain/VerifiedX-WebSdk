import CryptoJS from 'crypto-js';
import * as bip39 from 'bip39';
import KeypairService from '../../services/keypair-service';
import { isValidPrivateKey } from '../utils';
import { Network } from '../../constants';

/**
 * Browser-facing keypair service.
 *
 * Key generation, public-key/address derivation and signing delegate to the
 * canonical KeypairService: its dependency chain (elliptic, secp256k1's
 * pure-JS build, crypto-js, bip32) is fully browser-bundleable, and using a
 * single implementation guarantees browser output is byte-identical to
 * Node/CLI/web-wallet output. The previous @noble/secp256k1-based signing
 * path here broke with noble v3 ("hashes.sha256 not set") and, even when
 * wired, produced a different signature encoding than the rest of the
 * ecosystem.
 */
export class BrowserKeypairService {
  network: Network;
  private inner: KeypairService;

  constructor(network: Network) {
    this.network = network;
    this.inner = new KeypairService(network);
  }

  public generatePrivateKey(): string {
    return this.inner.generatePrivateKey();
  }

  public generateMnemonic(words: 12 | 24 = 12): string {
    return this.inner.generateMnemonic(words);
  }

  public privateKeyFromMnemonic(mnemonic: string, index: number): string {
    // NOTE: legacy non-BIP32 derivation, kept temporarily for compatibility.
    // Unlike the canonical privateKeyFromMneumonic (BIP32 m/0'/0'/index'),
    // this hashes the BIP39 seed with the index appended.
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const seedArray = new Uint8Array(seed);

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
    // NOTE: legacy non-BIP32 derivation, kept temporarily for compatibility.
    // The canonical implementation (KeypairService.privateKeyFromEmailPassword)
    // derives via BIP32 m/0'/0'/index' and matches the web wallet.
    email = email.toLowerCase();

    let seed = `${email}|${password}|`;
    seed = `${seed}${seed.length}|!@${((password.length * 7) + email.length) * 7}`;

    const chars = 1;
    const upperChars = 1;
    const numbers = 1;

    seed = `${seed}${(chars + upperChars + numbers) * password.length}3571`;
    seed = `${seed}${seed}`;

    for (let i = 0; i <= 50; i++) {
      seed = CryptoJS.SHA256(seed).toString(CryptoJS.enc.Hex);
    }

    const seedBytes = new TextEncoder().encode(seed);

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

    const privateKeyWordArray = CryptoJS.enc.Hex.parse(privateKey);
    if (!isValidPrivateKey(privateKeyWordArray)) {
      throw new Error('Generated private key is invalid');
    }

    // Prepend 00 for CLI BigInteger compatibility
    return '00' + privateKey;
  }

  public publicFromPrivate(privateKey: string): string {
    return this.inner.publicFromPrivate(privateKey);
  }

  public addressFromPrivate(privateKey: string): string {
    return this.inner.addressFromPrivate(privateKey);
  }

  public getSignature(message: string, privateKeyHex: string): string {
    return this.inner.getSignature(message, privateKeyHex);
  }
}

export default BrowserKeypairService;
