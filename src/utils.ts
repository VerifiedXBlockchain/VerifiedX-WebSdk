import CryptoJS from 'crypto-js';
import { Network } from './constants';
import { VfxAddress } from './types';

export function generateRandomInteger(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function generateRandomString(length: number, charset: string): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

export function generateRandomStringSecure(length: number, charset: string): string {
  try {
    // Try to access crypto (works in Node.js 15+ and browsers)
    const cryptoObj = typeof globalThis !== 'undefined' && globalThis.crypto
      ? globalThis.crypto
      : typeof global !== 'undefined' && (global as any).crypto
      ? (global as any).crypto
      : undefined;

    if (cryptoObj && cryptoObj.getRandomValues) {
      let result = '';
      const charsetLength = charset.length;
      const randomValues = new Uint8Array(length);
      cryptoObj.getRandomValues(randomValues);

      for (let i = 0; i < length; i++) {
        result += charset.charAt(randomValues[i] % charsetLength);
      }
      return result;
    }
  } catch (e) {
    // Fallback to non-secure version if crypto is unavailable
  }

  // Fallback to non-secure version if crypto is unavailable
  return generateRandomString(length, charset);
}

export function wordArrayToByteArray(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const len = wordArray.words.length;

  const u8_array = new Uint8Array(len << 2);
  let offset = 0;
  for (let i = 0; i < len; i++) {
    const word = wordArray.words[i];
    u8_array[offset++] = word >> 24;
    u8_array[offset++] = (word >> 16) & 0xff;
    u8_array[offset++] = (word >> 8) & 0xff;
    u8_array[offset++] = word & 0xff;
  }
  return u8_array;
}

export function byteArrayToWordArray(ba: Uint8Array): CryptoJS.lib.WordArray {
  const wa: number[] = [];

  for (let i = 0; i < ba.length; i++) {
    wa[(i / 4) | 0] |= ba[i] << (24 - 8 * i);
  }

  return CryptoJS.lib.WordArray.create(wa, ba.length);
}

export function hexToBn(hex: string): bigint {
  if (hex.length % 2) {
    hex = '0' + hex;
  }

  const highbyte = parseInt(hex.slice(0, 2), 16);
  let bn = BigInt('0x' + hex);

  if (0x80 & highbyte) {
    bn =
      BigInt(
        '0b' +
        bn
          .toString(2)
          .split('')
          .map(function (i) {
            return '0' === i ? 1 : 0;
          })
          .join(''),
      ) + BigInt(1);
    bn = -bn;
  }

  return bn;
}

export function hexStringToByteArray(hexString: string): Uint8Array {
  if (hexString.length % 2 !== 0) {
    throw 'Must have an even number of hex digits to convert to bytes';
  }
  const numBytes = hexString.length / 2;
  const byteArray = new Uint8Array(numBytes);
  for (let i = 0; i < numBytes; i++) {
    byteArray[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return byteArray;
}

export function concatArrays(arrays: Uint8Array[]): Uint8Array {
  // sum of individual array lengths
  const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);

  // if (!arrays.length) return [];

  const result = new Uint8Array(totalLength);

  // for each array - copy it over result
  // next array is copied right after the previous one
  let length = 0;
  for (const array of arrays) {
    result.set(array, length);
    length += array.length;
  }

  return result;
}

export function concatTwoArrays(arrayOne: Uint8Array, arrayTwo: Uint8Array): Uint8Array {
  const mergedArray = new Uint8Array(arrayOne.length + arrayTwo.length);
  mergedArray.set(arrayOne);
  mergedArray.set(arrayTwo, arrayOne.length);

  return mergedArray;
}

export function buf2hex(buffer: Uint8Array): string {
  const u = new Uint8Array(buffer);
  const a = new Array(u.length);
  let i = u.length;

  while (i--) {
    a[i] = (u[i] < 16 ? '0' : '') + u[i].toString(16);
  }

  return a.join('');
}

export function bnToArray(hex: string): Uint8Array {
  if (hex.length % 2) {
    hex = '0' + hex;
  }

  const len = hex.length / 2;
  const u8 = new Uint8Array(len);

  let i = 0;
  let j = 0;
  while (i < len) {
    u8[i] = parseInt(hex.slice(j, j + 2), 16);
    i += 1;
    j += 2;
  }

  return u8;
}

export function hexToString(hex: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Hex.parse(hex);
}

export function arrayToHex(uint8: Uint8Array): string {
  return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength).toString('hex');
}

const big0 = BigInt(0);
const big1 = BigInt(1);
const big8 = BigInt(8);

export function bigToUint8Array(big: bigint): Uint8Array {
  if (big < big0) {
    const bits: bigint = (BigInt(big.toString(2).length) / big8 + big1) * big8;
    const prefix1: bigint = big1 << bits;
    big += prefix1;
  }
  let hex = big.toString(16);
  if (hex.length % 2) {
    hex = '0' + hex;
  }
  const len = hex.length / 2;
  const u8 = new Uint8Array(len);
  let i = 0;
  let j = 0;
  while (i < len) {
    u8[i] = parseInt(hex.slice(j, j + 2), 16);
    i += 1;
    j += 2;
  }
  return u8;
}

export function normalizePrivateKey(privateKeyHex: string): string {
  // Strip leading 00 if present (CLI compatibility format)
  if (privateKeyHex.startsWith('00') && privateKeyHex.length === 66) {
    return privateKeyHex.substring(2);
  }
  return privateKeyHex;
}

export function isValidPrivateKey(privateKey: CryptoJS.lib.WordArray): boolean {
  const order = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';
  const privateKeyHex = privateKey.toString(CryptoJS.enc.Hex);
  return privateKeyHex < order && privateKeyHex.length === 64;
}

export function isValidAddress(address: string, network: Network): boolean {
  if (!address) return false;
  if (address.length != 34) return false;
  if (network == Network.Testnet) {
    if (address[0] !== 'x') return false;
  } else {
    if (address[0] !== 'R') return false;
  }

  const validChars = /^[a-zA-Z0-9]+$/;
  if (!validChars.test(address)) {
    return false;
  }

  return true;
}

export function isValidVfxDomain(domain: string): boolean {
  const domainRegex = /^[a-z0-9]+\.vfx$/;
  return domainRegex.test(domain.trim().toLowerCase());
}

export function isValidBtcDomain(domain: string): boolean {
  const domainRegex = /^[a-z0-9]+\.btc$/;
  return domainRegex.test(domain.trim().toLowerCase());
}

export function cleanVfxDomain(domain: string): string {
  let cleaned = domain.trim().toLowerCase();
  if (!cleaned.endsWith('.vfx')) {
    cleaned += '.vfx';
  }
  return cleaned;
}

export function cleanBtcDomain(domain: string): string {
  let cleaned = domain.trim().toLowerCase();
  if (!cleaned.endsWith('.btc')) {
    cleaned += '.btc';
  }
  return cleaned;
}

export function domainWithoutSuffix(domain: string): string {
  if (domain.includes('.vfx') || domain.includes('.btc') || domain.includes('.rbx')) {
    return domain.split('.')[0];
  }
  return domain;
}

export const addressWithoutActivity = (address: string): VfxAddress => {
  return {
    address: address,
    balance: 0,
    balanceTotal: 0,
    balanceLocked: 0,
    adnr: null,
    activated: false,
  };
};
