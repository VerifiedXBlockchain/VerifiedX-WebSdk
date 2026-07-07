import KeypairService from '../services/keypair-service';
import { BrowserKeypairService } from '../browser/services/keypair-service';
import { VfxClient as BrowserVfxClientFactory } from '../browser/index';
import { Network } from '../constants';

/**
 * The browser build must produce byte-identical crypto output to the Node
 * build. Signing is RFC6979-deterministic, so equality is exact.
 */

const nodeService = new KeypairService(Network.Testnet);
const browserService = new BrowserKeypairService(Network.Testnet);

describe('browser service delegates to canonical implementations', () => {
  const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';

  test('getSignature matches Node byte-for-byte', () => {
    for (let i = 0; i < 10; i++) {
      const message = `delegation-check-${i}`;
      expect(browserService.getSignature(message, privateKey)).toBe(nodeService.getSignature(message, privateKey));
    }
  });

  test('publicFromPrivate and addressFromPrivate match Node', () => {
    expect(browserService.publicFromPrivate(privateKey)).toBe(nodeService.publicFromPrivate(privateKey));
    expect(browserService.addressFromPrivate(privateKey)).toBe(nodeService.addressFromPrivate(privateKey));
  });

  test('generated keys round-trip through signing', () => {
    const generated = browserService.generatePrivateKey();
    expect(generated).toHaveLength(66);
    expect(() => browserService.getSignature('hello', generated)).not.toThrow();
  });
});

describe('BrowserVfxClient inherits canonical crypto', () => {
  const client = BrowserVfxClientFactory(Network.Testnet);

  test('getSignature works and matches the Node service', () => {
    const privateKey = client.generatePrivateKey();
    expect(client.getSignature('msg', privateKey)).toBe(nodeService.getSignature('msg', privateKey));
  });

  test('addressFromPrivate matches the Node service', () => {
    const privateKey = client.generatePrivateKey();
    expect(client.addressFromPrivate(privateKey)).toBe(nodeService.addressFromPrivate(privateKey));
  });
});
