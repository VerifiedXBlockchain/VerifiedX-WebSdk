import CryptoJS from 'crypto-js';
import base58 from 'bs58';
import EC from 'elliptic';
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import secp256k1 from 'secp256k1';
import {
  arrayToHex,
  byteArrayToWordArray,
  concatArrays,
  hexStringToByteArray,
  hexToString,
  isValidPrivateKey,
  wordArrayToByteArray,
} from '../utils';
import { Network } from '../constants';

export class KeypairService {
  network: Network;

  constructor(network: Network) {
    this.network = network;
  }

  public generatePrivateKey(): string {
    let privateKey: CryptoJS.lib.WordArray;

    do {
      privateKey = CryptoJS.lib.WordArray.random(32);
    } while (!isValidPrivateKey(privateKey));

    return privateKey.toString(CryptoJS.enc.Hex);
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
      return account.privateKey.toString('hex');
    }
    return '';
  }

  public privateKeyFromEmailPassword(email: string, password: string, index = 0): string {
    // Normalize email
    email = email.toLowerCase();

    // Create seed string with entropy
    let seed = `${email}|${password}|`;
    seed = `${seed}${seed.length}|!@${((password.length * 7) + email.length) * 7}`;

    const regChars = /[a-z]+/g;
    const regUpperChars = /[A-Z]+/g;
    const regNumbers = /[0-9]+/g;

    const charsMatches = password.match(regChars);
    const chars = charsMatches ? charsMatches.length : 1;

    const upperCharsMatches = password.match(regUpperChars);
    const upperChars = upperCharsMatches ? upperCharsMatches.length : 1;

    const numbersMatches = password.match(regNumbers);
    const numbers = numbersMatches ? numbersMatches.length : 1;

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
      return child.privateKey.toString('hex');
    }

    throw new Error('Failed to derive private key from email/password');
  }

  public publicFromPrivate(privateKey: string): string {
    const curve = new EC.ec('secp256k1');

    const buffer = Buffer.from(privateKey.toLowerCase(), 'hex');
    const keyPair = curve.keyFromPrivate(buffer);
    return keyPair.getPublic('hex');
  }

  public addressFromPrivate(privateKey: string): string {
    const curve = new EC.ec('secp256k1');

    const buffer = Buffer.from(privateKey.toLowerCase(), 'hex');
    const keyPair = curve.keyFromPrivate(buffer);
    const publicKey = keyPair.getPublic('hex');

    const pubKeySha = CryptoJS.SHA256(hexToString(publicKey));

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
    const data = CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);

    const privateKey = Buffer.from(privateKeyHex, 'hex');
    const dataBuffer = Buffer.from(data, 'hex');

    const { signature } = secp256k1.ecdsaSign(dataBuffer, privateKey);
    const derEncodedSignature = secp256k1.signatureExport(signature);

    const signatureBase64 = Buffer.from(derEncodedSignature).toString('base64');

    let publicKeyHex = this.publicFromPrivate(privateKeyHex);
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
