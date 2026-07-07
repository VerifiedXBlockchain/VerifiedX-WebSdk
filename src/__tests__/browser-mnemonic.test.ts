import KeypairService from '../services/keypair-service';
import { BrowserKeypairService } from '../browser/services/keypair-service';
import { VfxClient as BrowserVfxClientFactory } from '../browser/index';
import { Network } from '../constants';

const MNEMONIC =
  'entire taste skull already invest view turtle surge razor key next buffalo venue canoe sheriff winner wash ten subject hamster scrap unit shield garden';

const nodeService = new KeypairService(Network.Testnet);
const browserService = new BrowserKeypairService(Network.Testnet);

describe('browser mnemonic derivation is BIP32 (ecosystem-compatible)', () => {
  test.each([0, 1, 3])('index %i matches the canonical derivation', (index) => {
    expect(browserService.privateKeyFromMnemonic(MNEMONIC, index)).toBe(
      nodeService.privateKeyFromMneumonic(MNEMONIC, index),
    );
  });

  test('BrowserVfxClient.privateKeyFromMnemonic matches privateKeyFromMneumonic', () => {
    const client = BrowserVfxClientFactory(Network.Testnet);
    expect(client.privateKeyFromMnemonic(MNEMONIC, 0)).toBe(client.privateKeyFromMneumonic(MNEMONIC, 0));
  });

  test('email/password derivation matches the canonical derivation', () => {
    expect(browserService.privateKeyFromEmailPassword('test@verifiedx.io', 'test1234', 0)).toBe(
      nodeService.privateKeyFromEmailPassword('test@verifiedx.io', 'test1234', 0),
    );
  });
});

describe('legacy browser derivations preserved for fund recovery', () => {
  // Pinned outputs of the pre-v3.1.0 browser-only derivation. These must
  // never change: users may hold funds on addresses derived from them.
  test('legacy mnemonic derivation is pinned', () => {
    expect(browserService.privateKeyFromMnemonicLegacyBrowser(MNEMONIC, 0)).toBe(
      '00b4f68c2186c56be319306cb85d35d747abaa8eb54f8175e6172f9b21b0fb611b',
    );
    expect(browserService.privateKeyFromMnemonicLegacyBrowser(MNEMONIC, 1)).toBe(
      '000fd58b1a6ee8ea1e510ea389294264961db39cee5c50e92d23f565af9c41bb33',
    );
  });

  test('legacy email derivation is pinned', () => {
    expect(browserService.privateKeyFromEmailPasswordLegacyBrowser('test@verifiedx.io', 'test1234', 0)).toBe(
      '00444d28624f2c478da4e3d86bdde6f023247631bd412cbc0ac6a6a27c55c39cf4',
    );
  });

  test('legacy and BIP32 derivations differ (documents the old incompatibility)', () => {
    expect(browserService.privateKeyFromMnemonicLegacyBrowser(MNEMONIC, 0)).not.toBe(
      browserService.privateKeyFromMnemonic(MNEMONIC, 0),
    );
  });

  test('BrowserVfxClient exposes the legacy escape hatch', () => {
    const client = BrowserVfxClientFactory(Network.Testnet);
    expect(client.privateKeyFromMnemonicLegacyBrowser(MNEMONIC, 0)).toBe(
      '00b4f68c2186c56be319306cb85d35d747abaa8eb54f8175e6172f9b21b0fb611b',
    );
  });
});
