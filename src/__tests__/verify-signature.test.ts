import KeypairService, { verifySignature } from '../services/keypair-service';
import { BrowserKeypairService } from '../browser/services/keypair-service';
import { VfxClient } from '../client/vfx-client';
import { Network } from '../constants';
import { decodeBase64LikePython, decodePublicKey, parseStrictDerSignature } from '../services/vfx-signature';
import vectors from './compat/signature-vectors.json';

/**
 * verifySignature must accept exactly what butterfly-service's
 * verify_vfx_signature accepts. The shared vectors below are written for both
 * sides (butterfly-service keeps a copy as a fixture); the unit tests cover
 * the SDK side's round trips and the inputs JSON cannot carry.
 */

const testnet = new KeypairService(Network.Testnet);
const mainnet = new KeypairService(Network.Mainnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const otherPrivateKey = '0b1d1f3e5c7a99887766554433221100ffeeddccbbaa99887766554433221101';
const testnetAddress = testnet.addressFromPrivate(privateKey);
const mainnetAddress = mainnet.addressFromPrivate(privateKey);
const message = `vfx-chat-key:v1:testnet:${testnetAddress}:${'ab'.repeat(32)}`;

describe('verifySignature: shared vectors', () => {
  for (const vector of vectors.vectors) {
    test(`${vector.name} -> ${vector.expected}`, () => {
      expect(verifySignature(vector.message, vector.signature, vector.address)).toBe(vector.expected);
    });
  }

  test('vector keys derive the addresses the file records', () => {
    for (const key of vectors.keys) {
      expect(testnet.addressFromPrivate(key.privateKey)).toBe(key.testnet);
      expect(mainnet.addressFromPrivate(key.privateKey)).toBe(key.mainnet);
      expect(testnet.publicFromPrivate(key.privateKey)).toBe(key.publicKey);
    }
  });

  test('the padding case is a key whose public x starts with a zero byte', () => {
    expect(vectors.keys.some((key) => key.publicKey.startsWith('0400'))).toBe(true);
  });
});

describe('verifySignature: round trips', () => {
  test('a signature from getSignature verifies on both networks', () => {
    expect(testnet.verifySignature(message, testnet.getSignature(message, privateKey), testnetAddress)).toBe(true);
    expect(mainnet.verifySignature(message, mainnet.getSignature(message, privateKey), mainnetAddress)).toBe(true);
  });

  test('a 66-character (00-prefixed) private key signs the same', () => {
    expect(testnet.verifySignature(message, testnet.getSignature(message, '00' + privateKey), testnetAddress)).toBe(
      true,
    );
  });

  test('fresh random keys round-trip', () => {
    for (let i = 0; i < 10; i++) {
      const key = testnet.generatePrivateKey();
      const text = `message ${i}`;
      expect(verifySignature(text, testnet.getSignature(text, key), testnet.addressFromPrivate(key))).toBe(true);
    }
  });

  test('the network comes from the address, not the service', () => {
    const signature = testnet.getSignature(message, privateKey);
    expect(mainnet.verifySignature(message, signature, testnetAddress)).toBe(true);
    expect(testnet.verifySignature(message, signature, mainnetAddress)).toBe(true);
  });

  test('BrowserKeypairService and VfxClient give the same answers', () => {
    const signature = testnet.getSignature(message, privateKey);
    const browser = new BrowserKeypairService(Network.Testnet);
    const client = new VfxClient(Network.Testnet);
    expect(browser.verifySignature(message, signature, testnetAddress)).toBe(true);
    expect(client.verifySignature(message, signature, testnetAddress)).toBe(true);
    expect(browser.verifySignature(message + '!', signature, testnetAddress)).toBe(false);
    expect(client.verifySignature(message + '!', signature, testnetAddress)).toBe(false);
  });
});

describe('verifySignature: refusals', () => {
  const signature = testnet.getSignature(message, privateKey);

  test('wrong message', () => {
    expect(verifySignature(message.replace('testnet', 'mainnet'), signature, testnetAddress)).toBe(false);
  });

  test("another key's address, on either network", () => {
    expect(verifySignature(message, signature, testnet.addressFromPrivate(otherPrivateKey))).toBe(false);
    expect(verifySignature(message, signature, mainnet.addressFromPrivate(otherPrivateKey))).toBe(false);
  });

  test("the signer's reserve address", () => {
    expect(verifySignature(message, signature, testnet.reserveAddressFromPrivate(privateKey))).toBe(false);
  });

  test('never throws on malformed input', () => {
    const malformed = [
      '',
      '.',
      '..',
      'no-dot',
      `${signature}.`,
      signature.replace('.', '.0'),
      `!!!!.${signature.split('.')[1]}`,
      `${signature.split('.')[0]}.1111`,
      `é${signature}`,
    ];
    for (const bad of malformed) {
      expect(() => verifySignature(message, bad, testnetAddress)).not.toThrow();
      expect(verifySignature(message, bad, testnetAddress)).toBe(false);
    }
  });

  test('a message that cannot be UTF-8 encoded (lone surrogate) is false, not an exception', () => {
    expect(verifySignature('\ud800', signature, testnetAddress)).toBe(false);
  });

  test('non-string arguments are false', () => {
    const anyVerify = verifySignature as (...args: unknown[]) => boolean;
    expect(anyVerify(undefined, signature, testnetAddress)).toBe(false);
    expect(anyVerify(message, null, testnetAddress)).toBe(false);
    expect(anyVerify(message, signature, 42)).toBe(false);
  });
});

describe('vfx-signature parsing', () => {
  test('base64 follows Python b64decode', () => {
    expect(Buffer.from(decodeBase64LikePython('aGVsbG8=') as Uint8Array).toString()).toBe('hello');
    expect(Buffer.from(decodeBase64LikePython('aGVs\nbG8=') as Uint8Array).toString()).toBe('hello');
    expect(Buffer.from(decodeBase64LikePython('aGVsbG8=junk') as Uint8Array).toString()).toBe('hello');
    expect(decodeBase64LikePython('aGVsbG8')).toBeNull(); // missing padding
    expect(decodeBase64LikePython('aGVsb')).toBeNull(); // one data character past a quantum
    expect(decodeBase64LikePython('aGVsbG8=é')).toBeNull(); // non-ASCII anywhere
  });

  test('public keys: raw, 63-byte, uncompressed, compressed', () => {
    const xy = testnet.publicFromPrivate(privateKey).slice(2);
    const raw = Buffer.from(xy, 'hex');
    const odd = raw[63] & 1;
    expect(decodePublicKey(raw)).toBe(xy);
    expect(decodePublicKey(Buffer.concat([Buffer.from([4]), raw]))).toBe(xy);
    expect(decodePublicKey(Buffer.concat([Buffer.from([odd ? 3 : 2]), raw.subarray(0, 32)]))).toBe(xy);
    expect(decodePublicKey(raw.subarray(0, 62))).toBeNull();
    // x coordinate >= p is out of range even though the curve equation holds mod p
    expect(decodePublicKey(Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 0xff)]))).toBeNull();
    // (1, y) is on the curve; (p + 1, y) is the same point mod p and is refused
    const y = '4218f20ae6c646b363db68605822fb14264ca8d2587fdd6fbc750d587e76a7ee';
    const xOne = '01'.padStart(64, '0');
    const xPPlusOne = 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc30';
    expect(decodePublicKey(Buffer.from(xOne + y, 'hex'))).toBe(xOne + y);
    expect(decodePublicKey(Buffer.from(xPPlusOne + y, 'hex'))).toBeNull();
  });

  test('DER: minimal encodings only', () => {
    expect(parseStrictDerSignature(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]))).toEqual({
      r: BigInt(1),
      s: BigInt(2),
    });
    // non-minimal long-form length
    expect(parseStrictDerSignature(Uint8Array.from([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]))).toBeNull();
    // empty integer
    expect(parseStrictDerSignature(Uint8Array.from([0x30, 0x05, 0x02, 0x00, 0x02, 0x01, 0x02]))).toBeNull();
    // sequence length past the end
    expect(parseStrictDerSignature(Uint8Array.from([0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]))).toBeNull();
  });
});
