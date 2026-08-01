import KeypairService from '../../services/keypair-service';
import { Network } from '../../constants';
import vectors from './golden-vectors.json';

/**
 * Golden-vector compatibility gate.
 *
 * These vectors were generated from the VFX web wallet's compiled keygen
 * (vfx-gui/assets/js/keygen-v3.js) cross-checked against this SDK, and pin
 * the exact key derivation the ecosystem depends on:
 *
 *   private key -> public key -> address   (mainnet + testnet)
 *   email/password -> private key          (51x SHA256 seed -> BIP32 m/0'/0'/i')
 *   mnemonic -> private key                (BIP39 seed -> BIP32 m/0'/0'/i')
 *   message signatures                     (RFC6979 deterministic, DER.base58pubkey)
 *
 * If any assertion here fails, a change has broken compatibility with the
 * web wallet / CLI / mobile wallets. Do not update golden-vectors.json to
 * make a failure pass unless you can prove the wallet derives the new values.
 * To re-verify against the actual wallet bundle, run:
 *   node scripts/verify-wallet-compat.js
 */

const mainnetService = new KeypairService(Network.Mainnet);
const testnetService = new KeypairService(Network.Testnet);

describe('compat: private key -> address/pubkey', () => {
  test.each(vectors.privateKeys)(
    'key $privateKey derives pinned addresses',
    ({ privateKey, mainnetAddress, testnetAddress, publicKey }) => {
      expect(mainnetService.addressFromPrivate(privateKey)).toBe(mainnetAddress);
      expect(testnetService.addressFromPrivate(privateKey)).toBe(testnetAddress);
      expect(mainnetService.publicFromPrivate(privateKey)).toBe(publicKey);
    },
  );
});

describe('compat: email/password -> private key', () => {
  test.each(vectors.email)(
    '$email index $index derives pinned key',
    ({ email, password, index, privateKey, testnetAddress, mainnetAddress }) => {
      const derived = testnetService.privateKeyFromEmailPassword(email, password, index);
      expect(derived).toBe(privateKey);
      expect(testnetService.addressFromPrivate(derived)).toBe(testnetAddress);
      expect(mainnetService.addressFromPrivate(derived)).toBe(mainnetAddress);
    },
  );
});

describe("compat: mnemonic -> private key (BIP32 m/0'/0'/i')", () => {
  test.each(vectors.mnemonic)('index $index derives pinned key', ({ mnemonic, index, privateKey, mainnetAddress }) => {
    const derived = mainnetService.privateKeyFromMneumonic(mnemonic, index);
    expect(derived).toBe(privateKey);
    expect(mainnetService.addressFromPrivate(derived)).toBe(mainnetAddress);
  });
});

describe('compat: deterministic signatures (RFC6979)', () => {
  test.each(vectors.signatures)(
    'message "$message" signs to pinned signature',
    ({ privateKey, message, signature }) => {
      expect(mainnetService.getSignature(message, privateKey)).toBe(signature);
    },
  );
});
