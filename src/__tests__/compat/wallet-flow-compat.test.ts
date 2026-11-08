import KeypairService from '../../services/keypair-service';
import { Network } from '../../constants';
import {
  btcCredentialsFromDerivationText,
  btcKeypairFromDerivationText,
  canonicalPrivateKeyHex,
  derivationTextCandidates,
  normalizeRecoveryPhrase,
  walletDerivationText,
} from '../../services/wallet-derivation';
import { ReserveKeypair } from '../../types';
import vectors from './wallet-flow-vectors.json';

/**
 * Sign-in compatibility gate against the Flutter web wallet.
 *
 * wallet-flow-vectors.json is produced by
 * scripts/wallet-compat/gen-wallet-flow-vectors.js, which runs the wallet's
 * own Dart (email seed, recovery phrase, imported-key text) and its compiled
 * keygen-v3.js and btc.js. For every email/password, recovery phrase and
 * imported key it pins the VFX address, the vault (reserve account and restore
 * code) and the Bitcoin account on both networks.
 *
 * A failure means a user signing in to an SDK-based wallet would land on
 * different accounts than in the Flutter wallet. Never edit the vectors to make
 * a test pass; regenerate them from the wallet, and if the SDK disagrees, the
 * SDK is wrong (or the case is listed in KNOWN_EMAIL_MISMATCHES with why).
 */

const services = { testnet: new KeypairService(Network.Testnet), mainnet: new KeypairService(Network.Mainnet) };
const NETWORKS = ['testnet', 'mainnet'] as const;

type WalletReserve = typeof vectors.email[number]['testnet']['reserve'];
type WalletBtc = typeof vectors.email[number]['testnet']['btc'];

function expectSameVault(sdk: ReserveKeypair, wallet: WalletReserve): void {
  expect(sdk.address).toBe(wallet.address);
  expect(sdk.publicKey).toBe(wallet.publicKey);
  expect(sdk.privateKey).toBe('00' + wallet.privateKey);
  expect(sdk.recoveryAddress).toBe(wallet.recoveryAddress);
  expect(sdk.recoveryPublicKey).toBe(wallet.recoveryPublicKey);
  expect(sdk.recoveryPrivateKey).toBe('00' + wallet.recoveryPrivateKey);
  expect(sdk.restoreCode).toBe(wallet.restoreCode);
}

function expectSameBtc(derivationText: string, network: typeof NETWORKS[number], wallet: WalletBtc): void {
  const sdk = btcKeypairFromDerivationText(derivationText, network === 'testnet');
  expect(sdk.address).toBe(wallet.address);
  expect(sdk.wif).toBe(wallet.wif);
  expect(sdk.privateKey).toBe(wallet.privateKey);
  expect(sdk.publicKey).toBe(wallet.publicKey);
}

/**
 * Passwords for which the SDK knowingly derives a different key than the
 * wallet. auth_utils.dart writes its character-class regexes as JS literals
 * inside a Dart RegExp (`RegExp(r'/[a-z]+/g')`), so they match the literal
 * text "/abc/g", not letters. The SDK fixes each count at 1, which agrees with
 * the wallet unless the password holds two or more such slash runs of one
 * class. Those users get a different VFX account in the SDK.
 */
const KNOWN_EMAIL_MISMATCHES = new Set(['/abc/g/def/g']);

describe('compat(wallet): email/password sign in', () => {
  const matching = vectors.email.filter((v) => !KNOWN_EMAIL_MISMATCHES.has(v.password));

  test.each(matching)('$email / $password', (v) => {
    const privateKey = services.testnet.privateKeyFromEmailPassword(v.email, v.password);
    expect(privateKey).toBe('00' + v.privateKey);
    expect(walletDerivationText(privateKey)).toBe(v.derivationText);
    expect(btcCredentialsFromDerivationText(v.derivationText)).toEqual({ email: v.btcEmail, password: v.btcPassword });
    for (const network of NETWORKS) {
      expect(services[network].addressFromPrivate(privateKey)).toBe(v[network].address);
      expectSameVault(services[network].reserveKeypairFromPrivateKey(privateKey), v[network].reserve);
      expectSameBtc(walletDerivationText(privateKey), network, v[network].btc);
    }
  });

  test.each(vectors.email.filter((v) => KNOWN_EMAIL_MISMATCHES.has(v.password)))(
    'known mismatch stays known: $password',
    (v) => {
      expect(services.testnet.privateKeyFromEmailPassword(v.email, v.password)).not.toBe('00' + v.privateKey);
    },
  );
});

describe('compat(wallet): recovery phrase sign in', () => {
  test.each(vectors.mnemonic)('$words words, index $index: $phrase', (v) => {
    const normalized = normalizeRecoveryPhrase(v.phrase);
    expect(normalized).toBe(v.normalized);
    if (v.privateKey === null) {
      return;
    }
    const privateKey = services.mainnet.privateKeyFromMneumonic(normalized, v.index);
    expect(privateKey).toBe('00' + v.privateKey);
    expect(walletDerivationText(privateKey)).toBe(v.derivationText);
    for (const network of NETWORKS) {
      const expected = (v as Required<typeof v>)[network];
      expect(services[network].addressFromPrivate(privateKey)).toBe(expected.address);
      expectSameVault(services[network].reserveKeypairFromPrivateKey(privateKey), expected.reserve);
      expectSameBtc(walletDerivationText(privateKey), network, expected.btc);
    }
  });

  test('covers 12 and 24 words', () => {
    expect(new Set(vectors.mnemonic.map((v) => v.words))).toEqual(new Set([12, 24]));
    expect(vectors.mnemonic.every((v) => v.privateKey !== null)).toBe(true);
  });
});

describe('compat(wallet): imported private key', () => {
  test.each(vectors.importedKeys)('$entered', (v) => {
    const canonical = canonicalPrivateKeyHex(v.entered);
    expect(canonical).toBe(v.canonical);
    if (canonical === null) {
      return;
    }
    expect(services.testnet.addressFromPrivate(canonical)).toBe(v.testnetAddress);
    expect(services.mainnet.addressFromPrivate(canonical)).toBe(v.mainnetAddress);
    expect(derivationTextCandidates(canonical, v.entered)).toEqual(v.candidates.map((c) => c.derivationText));
    for (const candidate of v.candidates) {
      expect(btcCredentialsFromDerivationText(candidate.derivationText)).toEqual({
        email: candidate.btcEmail,
        password: candidate.btcPassword,
      });
      for (const network of NETWORKS) {
        expectSameVault(
          services[network].reserveKeypairFromDerivationText(candidate.derivationText),
          candidate[network].reserve,
        );
        expectSameBtc(candidate.derivationText, network, candidate[network].btc);
      }
    }
  });
});
