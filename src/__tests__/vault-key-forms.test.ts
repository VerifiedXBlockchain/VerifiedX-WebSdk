import { createHash } from 'crypto';
import KeypairService from '../services/keypair-service';
import { InvalidVaultKeyError } from '../services/vault-keys';
import { normalizePrivateKey } from '../utils';
import { Network } from '../constants';
import { VfxClient } from '../index';

// Vault restore codes and pasted vault/recovery keys in the forms Core and
// the wallets write them (wallet review 2026-11-10, findings C4 and C7).

const service = new KeypairService(Network.Testnet);
const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

/** What Core writes for a key: `BigInteger.ToString("x")`, minimal two's-complement hex. */
function coreHex(key64: string): string {
  const hex = BigInt('0x' + key64).toString(16);
  return parseInt(hex[0], 16) >= 8 ? '0' + hex : hex;
}

/** A restore code as Core's ReserveAccountInfo.RestoreCode writes it. */
function coreRestoreCode(vaultKey64: string, recoveryKey64: string): string {
  return Buffer.from(`${coreHex(vaultKey64)}//${coreHex(recoveryKey64)}`, 'utf-8').toString('base64');
}

const restoreCode = (vault: string, recovery: string) =>
  Buffer.from(`${vault}//${recovery}`, 'utf-8').toString('base64');

// Golden keys, found by hashing a label until the reserve address starts
// xRBX. The addresses were computed from the 64-digit form, which the
// compatibility vectors already pin.
const VAULT_HIGH = 'f8b3be55ff9be2a7f0ab5a36852127287192ae534df17f0d56cd2cfd9b43b137';
const VAULT_HIGH_ADDRESS = 'xRBXHTSw44wio9oaB4K8SmVCLd6zwmCn9t';
const VAULT_LOW = '000888d2d3f70f591b205064aff3a44667a1c1a6a20340150cbae61d2408e6c5';
const VAULT_LOW_ADDRESS = 'xRBXcz7nqqxZkYhGkALE8HswR34y2YDTH1';
const RECOVERY_HIGH = 'c7d29c3eb8bc60d7e7702ef51e8b89d13916ea55b09b3cd676089ccd712d4bee';
const RECOVERY_HIGH_ADDRESS = 'xBqFUiefNtSjj2zUAwBrp2G3E48N5yYeqW';
const RECOVERY_LOW = '003b3013d6230444af54339b59566a9a6c30a27ea23e4249b13d5389c9b12567';
const RECOVERY_LOW_ADDRESS = 'xMTNyew8N9srEkqGiYpbqCyLP4MEXawyoA';

/** reserveKeypairFromRestoreCode as it was in 9.1.1, to show accepted codes restore the same vault. */
function restoreCodeKeysBefore(code: string): { vault: string; recovery: string } | null {
  const parts = Buffer.from(code.trim(), 'base64').toString('utf-8').split('//');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const vault = normalizePrivateKey(parts[0].replace(/\s/g, '').toLowerCase());
  const recovery = normalizePrivateKey(parts[1].replace(/\s/g, '').toLowerCase());
  if (!/^[0-9a-f]{64}$/.test(vault) || !/^[0-9a-f]{64}$/.test(recovery)) return null;
  return { vault, recovery };
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Deterministic vault keys (xRBX addresses), a third with zeroed leading digits. */
function vaultKeys(count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; keys.length < count; i++) {
    let key = hash(`vault-key-forms:${i}`);
    if (i % 3 === 0) key = '0'.repeat((i % 4) + 1) + key.slice((i % 4) + 1);
    if (service.reserveAddressFromPrivate(key).startsWith('xRBX')) keys.push(key);
  }
  return keys;
}

describe('restore codes written by Core (C4)', () => {
  test('Core writes 65 digits for a key whose top digit is 8 to f', () => {
    expect(coreHex(VAULT_HIGH)).toBe('0' + VAULT_HIGH);
    expect(coreHex(VAULT_HIGH)).toHaveLength(65);
    expect(coreHex(VAULT_LOW)).toBe('0888d2d3f70f591b205064aff3a44667a1c1a6a20340150cbae61d2408e6c5');
    expect(coreHex(RECOVERY_LOW)).toBe('3b3013d6230444af54339b59566a9a6c30a27ea23e4249b13d5389c9b12567');
  });

  test.each([
    ['65-digit vault, 65-digit recovery', VAULT_HIGH, VAULT_HIGH_ADDRESS, RECOVERY_HIGH, RECOVERY_HIGH_ADDRESS],
    ['62-digit vault, 62-digit recovery', VAULT_LOW, VAULT_LOW_ADDRESS, RECOVERY_LOW, RECOVERY_LOW_ADDRESS],
    ['65-digit vault, 62-digit recovery', VAULT_HIGH, VAULT_HIGH_ADDRESS, RECOVERY_LOW, RECOVERY_LOW_ADDRESS],
  ])('%s restores the same vault as the 64-digit code', (_, vault, vaultAddress, recovery, recoveryAddress) => {
    const fromCore = service.reserveKeypairFromRestoreCode(coreRestoreCode(vault, recovery));
    expect(fromCore.address).toBe(vaultAddress);
    expect(fromCore.recoveryAddress).toBe(recoveryAddress);
    expect(fromCore.privateKey).toBe('00' + vault);
    expect(fromCore.recoveryPrivateKey).toBe('00' + recovery);
    expect(fromCore).toEqual(service.reserveKeypairFromRestoreCode(restoreCode(vault, recovery)));
  });

  test('every Core-written code restores, and to the vault of its 64-digit form', () => {
    const keys = vaultKeys(60);
    let refusedBefore = 0;
    for (let i = 0; i < keys.length; i++) {
      const recovery = hash(`recovery:${i}`);
      const code = coreRestoreCode(keys[i], recovery);
      if (restoreCodeKeysBefore(code) === null) refusedBefore++;
      expect(service.reserveKeypairFromRestoreCode(code)).toEqual(
        service.reserveKeypairFromRestoreCode(restoreCode(keys[i], recovery)),
      );
    }
    // The finding: most Core codes were refused before.
    expect(refusedBefore).toBeGreaterThan(20);
  });

  test('a code accepted before restores exactly the same keys', () => {
    const keys = vaultKeys(30);
    for (let i = 0; i < keys.length; i++) {
      const recovery = hash(`recovery-before:${i}`);
      const forms = [
        restoreCode(keys[i], recovery),
        restoreCode('00' + keys[i], '00' + recovery),
        restoreCode(keys[i].toUpperCase(), recovery.toUpperCase()),
        restoreCode(keys[i].replace(/^0+/, ''), recovery.replace(/^0+/, '')),
        restoreCode(`${keys[i].slice(0, 32)}\n${keys[i].slice(32)}`, ` ${recovery} `),
      ];
      for (const code of forms) {
        const before = restoreCodeKeysBefore(code);
        expect(before).not.toBeNull();
        const restored = service.reserveKeypairFromRestoreCode(code);
        expect(restored.privateKey).toBe('00' + (before as { vault: string }).vault);
        expect(restored.recoveryPrivateKey).toBe('00' + (before as { recovery: string }).recovery);
      }
    }
  });

  test('a 0x prefix is read as hex', () => {
    const restored = service.reserveKeypairFromRestoreCode(restoreCode('0x' + VAULT_HIGH, '0X' + RECOVERY_HIGH));
    expect(restored.address).toBe(VAULT_HIGH_ADDRESS);
    expect(restored.recoveryAddress).toBe(RECOVERY_HIGH_ADDRESS);
  });

  test.each([
    ['not hex', restoreCode('zz' + VAULT_HIGH, RECOVERY_HIGH), 'vault', 'not-hex'],
    ['recovery not hex', restoreCode(VAULT_HIGH, RECOVERY_HIGH.slice(0, 60) + 'qqqq'), 'recovery', 'not-hex'],
    ['a zero key', restoreCode(VAULT_HIGH, '0'.repeat(64)), 'recovery', 'out-of-range'],
    ['a key at the curve order', restoreCode(SECP256K1_ORDER.toString(16), RECOVERY_HIGH), 'vault', 'out-of-range'],
    ['a value above 2^256', restoreCode('1' + VAULT_HIGH, RECOVERY_HIGH), 'vault', 'out-of-range'],
  ])('refuses %s with InvalidVaultKeyError', (_, code, role, reason) => {
    let thrown: unknown;
    try {
      service.reserveKeypairFromRestoreCode(code);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidVaultKeyError);
    expect(thrown).toMatchObject({ role, reason, name: 'InvalidVaultKeyError' });
    expect(String((thrown as Error).message)).toMatch(/^Invalid restore code/);
  });
});

describe('pasted vault and recovery keys (C7)', () => {
  const client = new VfxClient(Network.Testnet);

  const forms = (key64: string): Array<[string, string]> => [
    ['64 digits', key64],
    ['00 + 64 digits', '00' + key64],
    ['Core text', coreHex(key64)],
    ['upper case', key64.toUpperCase()],
    ['0x prefix', '0x' + key64],
    ['wrapped over two lines', `${coreHex(key64).slice(0, 33)}\r\n${coreHex(key64).slice(33)}`],
    ['grouped with spaces', key64.replace(/(.{8})/g, '$1 ').trim()],
    ['leading zeros dropped', key64.replace(/^0+/, '')],
  ];

  test.each(forms(RECOVERY_HIGH))('a recovery key as %s gives the right address', (_, text) => {
    expect(client.recoveryKeypairFromPrivateKey(text)).toEqual({
      privateKey: '00' + RECOVERY_HIGH,
      publicKey: service.publicFromPrivate(RECOVERY_HIGH),
      address: RECOVERY_HIGH_ADDRESS,
    });
  });

  test.each(forms(RECOVERY_LOW))('a low recovery key as %s gives the right address', (_, text) => {
    expect(client.recoveryKeypairFromPrivateKey(text).address).toBe(RECOVERY_LOW_ADDRESS);
  });

  test.each([
    ...forms(VAULT_HIGH).map(([form, text]) => [form, text, VAULT_HIGH, VAULT_HIGH_ADDRESS]),
    ...forms(VAULT_LOW).map(([form, text]) => [form, text, VAULT_LOW, VAULT_LOW_ADDRESS]),
  ])('a vault key as %s gives the right vault', (_, text, key, address) => {
    expect(client.vaultKeypairFromPrivateKey(text)).toEqual({
      privateKey: '00' + key,
      publicKey: service.publicFromPrivate(key),
      address,
    });
  });

  test('a key that was accepted before gives the same vault as before', () => {
    for (const key of vaultKeys(30)) {
      for (const text of [key, '00' + key, key.toUpperCase(), key.replace(/^0+/, '')]) {
        const before = normalizePrivateKey(text.toLowerCase());
        expect(client.vaultKeypairFromPrivateKey(text)).toEqual({
          privateKey: '00' + before,
          publicKey: service.publicFromPrivate(before),
          address: service.reserveAddressFromPrivate(before),
        });
      }
    }
  });

  test.each([
    ['empty', '', 'not-hex'],
    ['not hex', 'g' + RECOVERY_HIGH.slice(1), 'not-hex'],
    ['a WIF', 'cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M', 'not-hex'],
    ['zero', '0'.repeat(64), 'out-of-range'],
    ['the curve order', SECP256K1_ORDER.toString(16), 'out-of-range'],
    ['65 digits that are not a leading 0', '1' + RECOVERY_HIGH, 'out-of-range'],
  ])('refuses %s with InvalidVaultKeyError', (_, text, reason) => {
    expect(() => client.recoveryKeypairFromPrivateKey(text)).toThrow(InvalidVaultKeyError);
    expect(() => client.recoveryKeypairFromPrivateKey(text)).toThrow(
      expect.objectContaining({ role: 'recovery', reason }),
    );
    expect(() => client.vaultKeypairFromPrivateKey(text)).toThrow(expect.objectContaining({ role: 'vault', reason }));
  });

  test('a vault key whose reserve address is not xRBX is still refused', () => {
    expect(() => client.vaultKeypairFromPrivateKey(RECOVERY_HIGH)).toThrow(/Not a reserve account key/);
  });
});
