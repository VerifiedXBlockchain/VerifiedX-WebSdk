import KeypairService from '../services/keypair-service';
import { BrowserKeypairService } from '../browser/services/keypair-service';
import { Network } from '../constants';
import { getSecureRandomBytes, isValidPrivateKey, normalizePrivateKey } from '../utils';

const nodeService = new KeypairService(Network.Mainnet);
const browserService = new BrowserKeypairService(Network.Mainnet);

describe('generatePrivateKey uses a CSPRNG', () => {
  test('draws from crypto.getRandomValues and never from Math.random', () => {
    const csprng = jest.spyOn(globalThis.crypto, 'getRandomValues');
    const mathRandom = jest.spyOn(Math, 'random');
    nodeService.generatePrivateKey();
    browserService.generatePrivateKey();
    expect(csprng).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
    csprng.mockRestore();
    mathRandom.mockRestore();
  });

  test.each([
    ['node', () => nodeService.generatePrivateKey()],
    ['browser', () => browserService.generatePrivateKey()],
  ])('%s service output keeps the 00+64hex format and is a valid key', (_label, generate) => {
    for (let i = 0; i < 25; i++) {
      const privateKey = generate();
      expect(privateKey).toHaveLength(66);
      expect(privateKey.startsWith('00')).toBe(true);
      expect(isValidPrivateKey(normalizePrivateKey(privateKey))).toBe(true);
    }
  });

  test('getSecureRandomBytes returns requested length with entropy', () => {
    const a = getSecureRandomBytes(32);
    const b = getSecureRandomBytes(32);
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(a.some((byte) => byte !== 0)).toBe(true);
  });
});

describe('normalizePrivateKey', () => {
  const key64 = '90a805984bd65764350d644d9cfb8ca483f7f4ae1e783833f4661f93ee053b73';

  test('strips 00 prefix from 66-char keys', () => {
    expect(normalizePrivateKey('00' + key64)).toBe(key64);
  });

  test('leaves 64-char keys untouched', () => {
    expect(normalizePrivateKey(key64)).toBe(key64);
  });

  test('left-pads short keys (wallet elliptic output with leading zero bytes)', () => {
    const short = key64.slice(2); // 62 chars, numerically = 0x00<rest>
    expect(normalizePrivateKey(short)).toBe('00' + key64.slice(2));
    expect(normalizePrivateKey(short)).toHaveLength(64);
  });

  test('62-char key signs and derives the same address as its padded form', () => {
    // A key whose top byte is zero, expressed unpadded the way the web
    // wallet's generate() emits it. Previously getSignature threw here.
    const padded = '00' + 'a7'.repeat(31);
    const unpadded = 'a7'.repeat(31);
    expect(nodeService.addressFromPrivate(unpadded)).toBe(nodeService.addressFromPrivate(padded));
    expect(() => nodeService.getSignature('message', unpadded)).not.toThrow();
    expect(nodeService.getSignature('message', unpadded)).toBe(nodeService.getSignature('message', padded));
  });
});

describe('isValidPrivateKey', () => {
  const order = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

  test('rejects zero', () => {
    expect(isValidPrivateKey('0'.repeat(64))).toBe(false);
  });

  test('rejects the curve order and above', () => {
    expect(isValidPrivateKey(order)).toBe(false);
    expect(isValidPrivateKey('f'.repeat(64))).toBe(false);
  });

  test('accepts order - 1 and 1', () => {
    const orderMinusOne = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140';
    expect(isValidPrivateKey(orderMinusOne)).toBe(true);
    expect(isValidPrivateKey('0'.repeat(63) + '1')).toBe(true);
  });
});
