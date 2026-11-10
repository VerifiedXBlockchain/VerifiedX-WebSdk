import { deriveBaseKeypair, evmAccountFromPrivateKey } from '../../services/base-wallet';
import { deriveBaseKeypair as browserDeriveBaseKeypair } from '../../browser/index';
import { deriveBaseKeypair as indexDeriveBaseKeypair } from '../../index';
import vectors from './base-keypair-vectors.json';

/**
 * Base (EVM) keypair vectors captured from Bfly's own code
 * (butterfly-web src/lib/baseWallet.ts, ethers 6.15.0). They pin the EVM
 * private key, address and public key Bfly derives from a VFX key, and the
 * inputs its normalizer refuses. A failure means a Bfly user's Base account
 * would come out different in the SDK. Regenerate base-keypair-vectors.json
 * only from Bfly's code, never from this one. TEST-ONLY keys.
 */

describe('compat: deriveBaseKeypair matches Bfly', () => {
  for (const vector of vectors.vectors) {
    test(`derives ${vector.label}`, async () => {
      expect(await deriveBaseKeypair(vector.vfxPrivateKey)).toEqual({
        address: vector.address,
        publicKey: vector.publicKey,
        privateKey: vector.privateKey,
      });
    });
  }

  for (const vector of vectors.invalid) {
    test(`refuses ${vector.label}`, async () => {
      await expect(deriveBaseKeypair(vector.vfxPrivateKey)).rejects.toThrow(vector.error as string);
    });
  }

  test('the package and browser entries export the same function', async () => {
    const [first] = vectors.vectors;
    expect(await indexDeriveBaseKeypair(first.vfxPrivateKey)).toEqual(await deriveBaseKeypair(first.vfxPrivateKey));
    expect(await browserDeriveBaseKeypair(first.vfxPrivateKey)).toEqual(await deriveBaseKeypair(first.vfxPrivateKey));
  });
});

describe('evmAccountFromPrivateKey', () => {
  test('private key 1 is the well-known Ethereum address', () => {
    expect(evmAccountFromPrivateKey('0'.repeat(63) + '1').address).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
  });

  test('refuses zero and the curve order, as ethers does', () => {
    expect(() => evmAccountFromPrivateKey('0'.repeat(64))).toThrow('outside the secp256k1 range');
    expect(() =>
      evmAccountFromPrivateKey('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'),
    ).toThrow('outside the secp256k1 range');
  });
});
