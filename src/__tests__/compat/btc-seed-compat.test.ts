import KeypairService from '../../services/keypair-service';
import { BrowserKeypairService } from '../../browser/services/keypair-service';
import { VfxClient } from '../../index';
import { Network } from '../../constants';
import vectors from './btc-seed-vectors.json';

/**
 * Sign in with a Bitcoin key: golden vectors generated from the web
 * wallet's compiled keygen (vfx-gui/assets/js/keygen-v3.js, seedToPrivate
 * and importPrivateKey) by replaying auth_utils.dart
 * handleImportWithBtcPrivateKey in headless Chrome. A failure here means a
 * user who signed in to the Flutter wallet with a Bitcoin key would land on
 * a different VFX account in the SDK. Regenerate btc-seed-vectors.json only
 * from the wallet bundle, never from this code.
 */

const services = { testnet: new KeypairService(Network.Testnet), mainnet: new KeypairService(Network.Mainnet) };

describe('compat: VFX key from a Bitcoin key (BTC sign-in)', () => {
  for (const vector of vectors.vectors) {
    test(`${vector.name} gives the wallet's account`, () => {
      const privateKey = services.testnet.privateKeyFromBtcKey(vector.btcKey);
      expect(privateKey).toBe('00' + vector.privateKey);
      expect(services.testnet.privateKeyFromSeedString(vector.seed)).toBe(privateKey);
      expect(services.testnet.publicFromPrivate(privateKey)).toBe(vector.publicKey);
      expect(services.testnet.addressFromPrivate(privateKey)).toBe(vector.testnetAddress);
      expect(services.mainnet.addressFromPrivate(privateKey)).toBe(vector.mainnetAddress);
    });
  }

  test('the key text is used as typed: case and encoding change the account', () => {
    const byName = Object.fromEntries(vectors.vectors.map((v) => [v.name, v.privateKey]));
    expect(byName.hexLower).not.toBe(byName.hexUpper);
    expect(byName.hexLower).not.toBe(byName.wifTestnet);
  });

  test('anything but 64 or 52 characters is refused, as the wallet refuses it', () => {
    for (const bad of ['', 'abc', `${vectors.vectors[0].btcKey} `, vectors.vectors[3].btcKey.slice(1)]) {
      expect(() => services.testnet.privateKeyFromBtcKey(bad)).toThrow(/64-character hex key or a 52-character WIF/);
    }
  });

  test('VfxClient and the browser build expose the same derivation', () => {
    const [vector] = vectors.vectors;
    expect(new VfxClient(Network.Testnet).privateKeyFromBtcKey(vector.btcKey)).toBe('00' + vector.privateKey);
    expect(new VfxClient(Network.Testnet).privateKeyFromSeedString(vector.seed)).toBe('00' + vector.privateKey);
    expect(new BrowserKeypairService(Network.Testnet).privateKeyFromBtcKey(vector.btcKey)).toBe(
      '00' + vector.privateKey,
    );
  });
});
