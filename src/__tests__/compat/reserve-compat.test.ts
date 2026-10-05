import KeypairService from '../../services/keypair-service';
import { Network } from '../../constants';
import vectors from './reserve-vectors.json';

/**
 * Reserve (vault) account golden vectors, generated from the web wallet's
 * compiled keygen (vfx-gui/assets/js/keygen-v3.js) by replaying
 * auth_utils.dart's derivation loop against it. They pin:
 *
 *   main private key  -> reserve private key (seed = first 32 hex chars + counter)
 *   reserve key       -> xRBX address (prefix 89 b9 21, hash truncated by 2)
 *   reserve key       -> recovery key (seed = first 32 hex chars of the reserve key)
 *   restore code      -> base64("<reservePriv>//<recoveryPriv>")
 *
 * A failure here means a vault created in the wallet would not be the same
 * vault in the SDK. Regenerate reserve-vectors.json only from the wallet
 * bundle, never from this code.
 */

const services = { testnet: new KeypairService(Network.Testnet), mainnet: new KeypairService(Network.Mainnet) };

describe('compat: reserve keypair from main private key', () => {
  for (const [name, vector] of Object.entries({
    fixed: vectors.fixed,
    prefixed00: vectors.prefixed00,
    leadingZeros: vectors.leadingZeros,
  })) {
    for (const network of ['testnet', 'mainnet'] as const) {
      test(`${name} on ${network} derives the wallet's vault`, () => {
        const expected = vector[network].vaultFromMain;
        const reserve = services[network].reserveKeypairFromPrivateKey(vector.mainPrivateKey);

        expect(reserve.address).toBe(expected.reserve.address);
        expect(reserve.address.startsWith('xRBX')).toBe(true);
        expect(reserve.publicKey).toBe(expected.reserve.publicKey);
        expect(reserve.privateKey).toBe('00' + expected.reserve.privateKey);
        expect(reserve.recoveryAddress).toBe(expected.recovery.address);
        expect(reserve.recoveryPublicKey).toBe(expected.recovery.publicKey);
        expect(reserve.recoveryPrivateKey).toBe('00' + expected.recovery.privateKey);
        expect(reserve.restoreCode).toBe(expected.restoreCode);

        // The seed the wallet used is reproduced exactly (counter included).
        expect(services[network].privateKeyFromSeedString(expected.seed)).toBe('00' + expected.reserve.privateKey);
        expect(services[network].addressFromPrivate(vector.mainPrivateKey)).toBe(vector[network].mainAddress);
      });
    }
  }
});

describe('compat: reserve keypair from the reserve key itself', () => {
  const v = vectors.directFromReserveKey;

  test('recovery key and restore code match the wallet', () => {
    const reserve = services.testnet.reserveKeypairFromReservePrivateKey(v.reservePrivateKey);
    expect(reserve.address).toBe(v.reserveAddress);
    expect(reserve.recoveryPrivateKey).toBe('00' + v.recoveryPrivateKey);
    expect(reserve.recoveryAddress).toBe(v.recoveryAddressTestnet);
    expect(reserve.restoreCode).toBe(v.restoreCode);
    expect(services.mainnet.reserveKeypairFromReservePrivateKey(v.reservePrivateKey).recoveryAddress).toBe(
      v.recoveryAddressMainnet,
    );
  });

  test('a 00-prefixed key derives the same vault as the bare key', () => {
    const bare = services.testnet.reserveKeypairFromReservePrivateKey(v.reservePrivateKey);
    const prefixed = services.testnet.reserveKeypairFromReservePrivateKey('00' + v.reservePrivateKey);
    expect(prefixed).toEqual(bare);
  });

  test('reserveAddressFromPublic is network-independent and matches', () => {
    const publicKey = services.testnet.publicFromPrivate(v.reservePrivateKey);
    expect(services.testnet.reserveAddressFromPublic(publicKey)).toBe(v.reserveAddress);
    expect(services.mainnet.reserveAddressFromPublic(publicKey)).toBe(v.reserveAddress);
    expect(services.mainnet.reserveAddressFromPublic(publicKey.slice(2))).toBe(v.reserveAddress);
  });

  test('restore code round-trips and keeps the recovery key it carries', () => {
    const restored = services.testnet.reserveKeypairFromRestoreCode(v.restoreCode);
    expect(restored.address).toBe(v.reserveAddress);
    expect(restored.recoveryPrivateKey).toBe('00' + v.recoveryPrivateKey);
    expect(restored.restoreCode).toBe(v.restoreCode);

    // A CLI-style code with an independent recovery key is honoured as-is.
    const other = services.testnet.generatePrivateKey().slice(2);
    const cliCode = Buffer.from(`${v.reservePrivateKey}//${other}`, 'utf-8').toString('base64');
    const cli = services.testnet.reserveKeypairFromRestoreCode(cliCode);
    expect(cli.recoveryPrivateKey).toBe('00' + other);
    expect(cli.recoveryAddress).toBe(services.testnet.addressFromPrivate(other));
  });

  test('rejects malformed restore codes', () => {
    expect(() => services.testnet.reserveKeypairFromRestoreCode('not-base64!!')).toThrow(/Invalid restore code/);
    expect(() =>
      services.testnet.reserveKeypairFromRestoreCode(Buffer.from('onlyonekey', 'utf-8').toString('base64')),
    ).toThrow(/Invalid restore code/);
  });
});

describe('generateReserveKeypair', () => {
  test('produces an xRBX vault whose restore code re-derives itself', () => {
    const reserve = services.testnet.generateReserveKeypair();
    expect(reserve.address.startsWith('xRBX')).toBe(true);
    expect(reserve.recoveryAddress.startsWith('x')).toBe(true);
    expect(services.testnet.reserveKeypairFromRestoreCode(reserve.restoreCode)).toEqual(reserve);
    expect(services.testnet.reserveKeypairFromReservePrivateKey(reserve.privateKey)).toEqual(reserve);
  });
});
