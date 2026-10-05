import CryptoJS from 'crypto-js';
import base58 from 'bs58';
import EC from 'elliptic';
import ecc from '@bitcoinerlab/secp256k1';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import {
  arrayToHex,
  byteArrayToWordArray,
  concatArrays,
  getSecureRandomBytes,
  hexStringToByteArray,
  hexToString,
  isValidPrivateKey,
  normalizePrivateKey,
  wordArrayToByteArray,
} from '../utils';
import { Network, RESERVE_ADDRESS_PREFIX } from '../constants';
import { ReserveKeypair } from '../types';

// Curve context construction is the expensive part of elliptic — build once.
const secp256k1Curve = new EC.ec('secp256k1');

// Address version bytes. A reserve address carries a three-byte prefix and
// drops the last two bytes of the RIPEMD-160 hash so the whole thing still
// base58-encodes to the usual 34 characters — that is why it starts "xRBX".
const RESERVE_ADDRESS_PREFIX_BYTES = [0x89, 0xb9, 0x21];
const RESERVE_ADDRESS_HASH_TRUNCATION = 2;
/** How many derivation attempts before giving up on finding an xRBX address. */
const RESERVE_DERIVATION_MAX_ATTEMPTS = 1000;

export class KeypairService {
  network: Network;

  constructor(network: Network) {
    this.network = network;
  }

  public generatePrivateKey(): string {
    // Native CSPRNG only — CryptoJS.lib.WordArray.random (crypto-js 3.x) is
    // seeded from Math.random and must never be used for key material.
    let privateKey: CryptoJS.lib.WordArray;

    do {
      privateKey = byteArrayToWordArray(getSecureRandomBytes(32));
    } while (!isValidPrivateKey(privateKey));

    // Prepend 00 for CLI BigInteger compatibility
    return '00' + privateKey.toString(CryptoJS.enc.Hex);
  }

  public generateMnemonic(words: 12 | 24 = 12): string {
    return bip39.generateMnemonic(words == 12 ? 128 : 256);
  }

  public privateKeyFromMneumonic(mnemonic: string, index: number): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    const bip32 = BIP32Factory(ecc);

    const root = bip32.fromSeed(seed);

    const account = root.derivePath(`m/0'/0'/${index}'`);
    if (account.privateKey) {
      // Prepend 00 for CLI BigInteger compatibility
      return '00' + account.privateKey.toString('hex');
    }
    return '';
  }

  public privateKeyFromEmailPassword(email: string, password: string, index = 0): string {
    // Normalize email
    email = email.toLowerCase();

    // Create seed string with entropy
    let seed = `${email}|${password}|`;
    seed = `${seed}${seed.length}|!@${(password.length * 7 + email.length) * 7}`;

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

    // Derive private key from seed using BIP32 (treat seed string as UTF-8, not hex)
    const bip32 = BIP32Factory(ecc);
    const seedBuffer = Buffer.from(seed, 'utf-8');
    const node = bip32.fromSeed(seedBuffer);
    const child = node.derivePath(`m/0'/0'/${index}'`);

    if (child.privateKey) {
      // Prepend 00 for CLI BigInteger compatibility
      return '00' + child.privateKey.toString('hex');
    }

    throw new Error('Failed to derive private key from email/password');
  }

  public publicFromPrivate(privateKey: string): string {
    // Normalize to handle both 64 and 66 char formats
    const normalized = normalizePrivateKey(privateKey.toLowerCase());
    const buffer = Buffer.from(normalized, 'hex');
    const keyPair = secp256k1Curve.keyFromPrivate(buffer);
    return keyPair.getPublic('hex');
  }

  public addressFromPrivate(privateKey: string): string {
    // Normalize to handle both 64 and 66 char formats
    const normalized = normalizePrivateKey(privateKey.toLowerCase());
    const buffer = Buffer.from(normalized, 'hex');
    const keyPair = secp256k1Curve.keyFromPrivate(buffer);
    return this.addressFromPublic(keyPair.getPublic('hex'));
  }

  /**
   * Derive the network address for an uncompressed secp256k1 public key (hex,
   * with or without the `04` prefix). This is how an external signer's address
   * is obtained without the SDK ever seeing the private key.
   */
  public addressFromPublic(publicKeyHex: string): string {
    const publicKey = this.normalizedPublicKey(publicKeyHex);
    if (!/^[0-9a-f]+$/.test(publicKey)) {
      throw new Error('Invalid public key: not hex');
    }

    return this.hashPublicKeyToAddress(publicKey, [this.network == Network.Testnet ? 0x89 : 0x3c], 0);
  }

  private hashPublicKeyToAddress(publicKeyHex: string, prefixBytes: number[], truncateBy: number): string {
    const pubKeySha = CryptoJS.SHA256(hexToString(publicKeyHex));
    const pubKeyShaRipe = CryptoJS.RIPEMD160(pubKeySha);

    let preHashWNetworkData = concatArrays([new Uint8Array(prefixBytes), wordArrayToByteArray(pubKeyShaRipe)]);
    if (truncateBy > 0) {
      preHashWNetworkData = preHashWNetworkData.slice(0, preHashWNetworkData.length - truncateBy);
    }

    const publicHash = CryptoJS.SHA256(byteArrayToWordArray(preHashWNetworkData));
    const publicHashHash = CryptoJS.SHA256(publicHash);
    const checksum = publicHashHash.toString(CryptoJS.enc.Hex).slice(0, 8);

    return base58.encode(hexStringToByteArray(`${arrayToHex(preHashWNetworkData)}${checksum}`));
  }

  private normalizedPublicKey(publicKeyHex: string): string {
    const hex = publicKeyHex.trim().toLowerCase();
    if (hex.length === 130 && hex.startsWith('04')) {
      return hex;
    }
    if (hex.length === 128) {
      return '04' + hex;
    }
    throw new Error(`Invalid public key: expected 128 hex chars (optional 04 prefix), got ${hex.length} chars`);
  }

  // ---------------------------------------------------------------------------
  // Reserve (Vault) accounts
  //
  // Derivation mirrors the web wallet (auth_utils.dart + keygen-v3.js) so a
  // vault created in either place is the same vault here. Pinned by the
  // reserve golden vectors in the compat tests.
  // ---------------------------------------------------------------------------

  /**
   * The reserve ("xRBX") address for a public key. Same key material as the
   * ordinary address, different version bytes; not network-dependent.
   */
  public reserveAddressFromPublic(publicKeyHex: string): string {
    return this.hashPublicKeyToAddress(
      this.normalizedPublicKey(publicKeyHex),
      RESERVE_ADDRESS_PREFIX_BYTES,
      RESERVE_ADDRESS_HASH_TRUNCATION,
    );
  }

  public reserveAddressFromPrivate(privateKey: string): string {
    return this.reserveAddressFromPublic(this.publicFromPrivate(privateKey));
  }

  /**
   * BIP32 m/0'/0'/index' with an arbitrary string as the seed bytes (UTF-8).
   * This is the web wallet's `seedToPrivate`; both reserve derivations below
   * are built on it.
   */
  public privateKeyFromSeedString(seed: string, index = 0): string {
    const bip32 = BIP32Factory(ecc);
    const child = bip32.fromSeed(Buffer.from(seed, 'utf-8')).derivePath(`m/0'/0'/${index}'`);
    if (!child.privateKey) {
      throw new Error('Failed to derive private key from seed');
    }
    return '00' + child.privateKey.toString('hex');
  }

  /**
   * Build the full reserve keypair from the reserve account's own private
   * key. The recovery key is derived from the first 32 hex characters of that
   * key, exactly as the web wallet does, so it never has to be stored
   * separately. Throws if the key's reserve address does not start with
   * xRBX — such a key cannot be a vault on the network.
   */
  public reserveKeypairFromReservePrivateKey(reservePrivateKey: string): ReserveKeypair {
    const privateKey = normalizePrivateKey(reservePrivateKey.toLowerCase());
    const address = this.reserveAddressFromPrivate(privateKey);
    if (!address.startsWith(RESERVE_ADDRESS_PREFIX)) {
      throw new Error(
        `Not a reserve account key: its reserve address ${address} does not start with ${RESERVE_ADDRESS_PREFIX}`,
      );
    }
    const recoveryPrivateKey = this.privateKeyFromSeedString(privateKey.slice(0, 32));
    return this.assembleReserveKeypair(privateKey, recoveryPrivateKey);
  }

  /**
   * The vault the web wallet pairs with a main account: the reserve private
   * key is derived from the first 32 hex characters of the main private key
   * plus a counter, retried until the reserve address starts with xRBX.
   */
  public reserveKeypairFromPrivateKey(mainPrivateKey: string): ReserveKeypair {
    // The wallet strips a leading "00" from the main key before seeding even
    // when the key is already 64 characters (auth_utils.dart), so a key whose
    // first byte is zero seeds from its 3rd character. Reproduced on purpose:
    // the alternative is a vault that exists in the wallet and not here.
    let input = normalizePrivateKey(mainPrivateKey.toLowerCase());
    if (input.startsWith('00')) {
      input = input.slice(2);
    }
    for (let append = 0; append < RESERVE_DERIVATION_MAX_ATTEMPTS; append++) {
      const reservePrivateKey = this.privateKeyFromSeedString(`${input.slice(0, 32)}${append}`);
      if (this.reserveAddressFromPrivate(reservePrivateKey).startsWith(RESERVE_ADDRESS_PREFIX)) {
        return this.reserveKeypairFromReservePrivateKey(reservePrivateKey);
      }
    }
    throw new Error('Could not derive a reserve address from this key');
  }

  /**
   * Restore from `base64("<privateKey>//<recoveryPrivateKey>")` — the code the
   * CLI prints and the web wallet backs up. The recovery key is taken from the
   * code, not re-derived, because the CLI generates it independently.
   */
  public reserveKeypairFromRestoreCode(restoreCode: string): ReserveKeypair {
    const decoded = Buffer.from(restoreCode.trim(), 'base64').toString('utf-8');
    const parts = decoded.split('//');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('Invalid restore code: expected base64 of "<privateKey>//<recoveryPrivateKey>"');
    }
    const privateKey = normalizePrivateKey(parts[0].replace(/\s/g, '').toLowerCase());
    const recoveryPrivateKey = normalizePrivateKey(parts[1].replace(/\s/g, '').toLowerCase());
    if (!/^[0-9a-f]{64}$/.test(privateKey) || !/^[0-9a-f]{64}$/.test(recoveryPrivateKey)) {
      throw new Error('Invalid restore code: keys are not hex');
    }
    const address = this.reserveAddressFromPrivate(privateKey);
    if (!address.startsWith(RESERVE_ADDRESS_PREFIX)) {
      throw new Error(`Invalid restore code: reserve address ${address} does not start with ${RESERVE_ADDRESS_PREFIX}`);
    }
    return this.assembleReserveKeypair(privateKey, '00' + recoveryPrivateKey);
  }

  /** A standalone vault on a fresh random key, not tied to any main account. */
  public generateReserveKeypair(): ReserveKeypair {
    for (let attempt = 0; attempt < RESERVE_DERIVATION_MAX_ATTEMPTS; attempt++) {
      const privateKey = this.generatePrivateKey();
      if (this.reserveAddressFromPrivate(privateKey).startsWith(RESERVE_ADDRESS_PREFIX)) {
        return this.reserveKeypairFromReservePrivateKey(privateKey);
      }
    }
    throw new Error('Could not generate a reserve address');
  }

  private assembleReserveKeypair(privateKey64: string, recoveryPrivateKey: string): ReserveKeypair {
    const recoveryPrivateKey64 = normalizePrivateKey(recoveryPrivateKey);
    return {
      privateKey: '00' + privateKey64,
      publicKey: this.publicFromPrivate(privateKey64),
      address: this.reserveAddressFromPrivate(privateKey64),
      recoveryPrivateKey: '00' + recoveryPrivateKey64,
      recoveryPublicKey: this.publicFromPrivate(recoveryPrivateKey64),
      recoveryAddress: this.addressFromPrivate(recoveryPrivateKey64),
      // Wallet/CLI format: bare 64-char hex on both sides.
      restoreCode: Buffer.from(`${privateKey64}//${recoveryPrivateKey64}`, 'utf-8').toString('base64'),
    };
  }

  public getSignature(message: string, privateKeyHex: string): string {
    // Normalize to handle both 64 and 66 char formats
    const normalized = normalizePrivateKey(privateKeyHex);

    const data = CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);

    const privateKey = Buffer.from(normalized, 'hex');
    const dataBuffer = Buffer.from(data, 'hex');

    // RFC6979 deterministic k + canonical low-s, DER-encoded — byte-identical
    // to the former native secp256k1 ecdsaSign/signatureExport output
    // (locked by the compat golden vectors).
    const keyPair = secp256k1Curve.keyFromPrivate(privateKey);
    const derEncodedSignature = Buffer.from(keyPair.sign(dataBuffer, { canonical: true }).toDER());

    const signatureBase64 = derEncodedSignature.toString('base64');

    let publicKeyHex = this.publicFromPrivate(normalized);
    if (publicKeyHex.substring(0, 2) === '04') {
      publicKeyHex = publicKeyHex.substring(2);
    }

    const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
    const publicKeyBufferBase58 = base58.encode(publicKeyBuffer);

    const fullSignature = `${signatureBase64}.${publicKeyBufferBase58}`;

    return fullSignature;
  }
}

export default KeypairService;
