import KeypairService, { hkdfSha256 } from '../services/keypair-service';
import { Network } from '../constants';

const testnet = new KeypairService(Network.Testnet);
const mainnet = new KeypairService(Network.Mainnet);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fromHex = (text: string) => Uint8Array.from(Buffer.from(text, 'hex'));

describe('hkdfSha256', () => {
  test('matches RFC 5869 test cases 1 and 3', () => {
    const okm1 = hkdfSha256(
      fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'),
      fromHex('000102030405060708090a0b0c'),
      fromHex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    );
    expect(hex(okm1)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
    const okm3 = hkdfSha256(
      fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'),
      new Uint8Array(0),
      new Uint8Array(0),
      42,
    );
    expect(hex(okm3)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
  });
});

describe('recoveryKeyFromPasskeyPrf', () => {
  const prf = fromHex('7f'.repeat(32));

  test('is deterministic, an ordinary account, and not the PRF output itself', () => {
    const key = testnet.recoveryKeyFromPasskeyPrf(prf);
    expect(testnet.recoveryKeyFromPasskeyPrf(prf.buffer.slice(0) as ArrayBuffer)).toEqual(key);
    expect(key.privateKey).toMatch(/^00[0-9a-f]{64}$/);
    expect(key.privateKey.slice(2)).not.toBe(hex(prf));
    expect(key.address).toBe(testnet.addressFromPrivate(key.privateKey));
    expect(key.address.startsWith('xRBX')).toBe(false);
    expect(mainnet.recoveryKeyFromPasskeyPrf(prf).privateKey).toBe(key.privateKey);
  });

  // Pinned so the salt, info or HKDF can never change silently: a change
  // would lock every passkey-recovered vault out of its recovery key.
  test('pins the derivation', () => {
    expect(testnet.recoveryKeyFromPasskeyPrf(prf).privateKey).toBe(PINNED_PRF_KEY);
  });

  test('different PRF outputs give different keys, and short outputs are refused', () => {
    expect(testnet.recoveryKeyFromPasskeyPrf(fromHex('01'.repeat(32))).privateKey).not.toBe(
      testnet.recoveryKeyFromPasskeyPrf(prf).privateKey,
    );
    expect(() => testnet.recoveryKeyFromPasskeyPrf(new Uint8Array(16))).toThrow(/at least 32 bytes/);
  });
});

describe('newRecoveryKey and newVaultKeypair', () => {
  test('are random, independent keys', () => {
    const vault = testnet.newVaultKeypair();
    const recovery = testnet.newRecoveryKey();
    expect(vault.address.startsWith('xRBX')).toBe(true);
    expect(recovery.address.startsWith('xRBX')).toBe(false);
    expect(recovery.privateKey).not.toBe(vault.privateKey);
    // Nothing about the recovery key is computable from the vault key.
    expect(testnet.restoreLegacyWebWalletVaultFromVaultKey(vault.privateKey).recoveryAddress).not.toBe(
      recovery.address,
    );
    expect(testnet.newRecoveryKey().privateKey).not.toBe(recovery.privateKey);
  });
});

// Node's crypto.hkdfSync('sha256', 0x7f x 32, salt, info, 32) gives the same 32 bytes.
const PINNED_PRF_KEY = '00ab4d4b9d0c37c1bb2f30e93094078ebe77473587661270e6e662de7e02b34c46';
