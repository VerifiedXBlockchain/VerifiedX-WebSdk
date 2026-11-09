import {
  VfxClient,
  canCallBackReserveTransaction,
  reserveRestoreCode,
  vaultBackupCode,
  vaultKeyFromBackupCode,
} from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { HashableTransaction, transactionHash } from '../services/transaction-hash';
import { CapturedCall, installFetch, textResponse } from './helpers/mock-fetch';

const service = new KeypairService(Network.Testnet);
const vault = service.newVaultKeypair();
const recovery = service.newRecoveryKey();
const NOW = Date.parse('2026-11-08T12:00:00Z');

afterEach(() => jest.restoreAllMocks());

describe('canCallBackReserveTransaction (Flutter WebCallbackButton rules)', () => {
  const send = {
    hash: 'SEND',
    from_address: vault.address,
    to_address: 'xSomeone',
    height: 100,
    unlock_time: '2026-11-09T12:00:00Z',
  };
  test('a confirmed send still locked can be called back', () => {
    expect(canCallBackReserveTransaction(send, vault.address, { now: NOW })).toBe(true);
  });
  test('not after it unlocks, not while pending, not for another sender or a reserve operation', () => {
    expect(
      canCallBackReserveTransaction({ ...send, unlock_time: '2026-11-08T11:00:00Z' }, vault.address, { now: NOW }),
    ).toBe(false);
    expect(canCallBackReserveTransaction({ ...send, height: 0 }, vault.address, { now: NOW })).toBe(false);
    expect(canCallBackReserveTransaction({ ...send, unlock_time: null }, vault.address, { now: NOW })).toBe(false);
    expect(canCallBackReserveTransaction(send, 'xRBXSomeOtherVault', { now: NOW })).toBe(false);
    expect(canCallBackReserveTransaction({ ...send, to_address: 'Reserve_Base' }, vault.address, { now: NOW })).toBe(
      false,
    );
  });
  test('not once a CallBack() in the history names it', () => {
    expect(
      canCallBackReserveTransaction(send, vault.address, {
        now: NOW,
        vaultHistory: [{ callback_details: { hash: 'SEND' } }],
      }),
    ).toBe(false);
  });
});

describe('vault backup formats', () => {
  test('vaultBackupCode round-trips the vault key alone and catches typos', () => {
    const code = vaultBackupCode(vault.privateKey);
    expect(code).toMatch(/^vfxvault1-[0-9a-f]{72}$/);
    expect(vaultKeyFromBackupCode(code)).toBe(vault.privateKey);
    expect(service.vaultKeypairFromPrivateKey(vaultKeyFromBackupCode(code.toUpperCase()))).toEqual(vault);
    const typo = code.slice(0, 20) + (code[20] === 'a' ? 'b' : 'a') + code.slice(21);
    expect(() => vaultKeyFromBackupCode(typo)).toThrow(/checksum/);
    expect(() => vaultKeyFromBackupCode('nope')).toThrow(/Not a vault backup code/);
  });

  test('reserveRestoreCode is the CLI/Flutter restore code for independent keys', () => {
    const code = reserveRestoreCode(vault.privateKey, recovery.privateKey);
    const restored = service.reserveKeypairFromRestoreCode(code);
    expect(restored.address).toBe(vault.address);
    expect(restored.recoveryAddress).toBe(recovery.address);
  });

  test('a restore code with more than two parts is read like Core reads it, first two parts', () => {
    const code = Buffer.from(
      `${
        reserveRestoreCode(vault.privateKey, recovery.privateKey) &&
        Buffer.from(reserveRestoreCode(vault.privateKey, recovery.privateKey), 'base64').toString()
      }//extra`,
    ).toString('base64');
    expect(service.reserveKeypairFromRestoreCode(code).recoveryAddress).toBe(recovery.address);
  });
});

describe('fundAndRegisterVault', () => {
  const funderKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
  const funder = {
    privateKey: funderKey,
    publicKey: service.publicFromPrivate(funderKey),
    address: service.addressFromPrivate(funderKey),
  };

  function install(balances: number[]) {
    let reads = 0;
    return installFetch({
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
      '/raw/hash/': (_u: string, init?: RequestInit) => ({
        Result: 'Success',
        Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
      }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
      '/raw/send/': () => ({ Result: 'Success' }),
      [`/addresses/${vault.address}`]: () => {
        const balance = balances[Math.min(reads, balances.length - 1)];
        reads += 1;
        return { address: vault.address, balance, balance_total: balance, activated: false };
      },
    });
  }
  const sends = (calls: CapturedCall[]) =>
    calls
      .filter((c) => c.url.includes('/raw/send/'))
      .map((c) => (c.body as { transaction: Record<string, unknown> }).transaction);

  test('funds 5 VFX, waits for it to land, then registers with the recovery address', async () => {
    const { calls } = install([0, 0, 5]);
    const result = await new VfxClient('testnet').fundAndRegisterVault(funder, vault, {
      recoveryAddress: recovery.address,
      pollIntervalMs: 1,
    });
    const [funding, registration] = sends(calls);
    expect(funding).toMatchObject({ FromAddress: funder.address, ToAddress: vault.address, Amount: 5 });
    expect(registration).toMatchObject({
      FromAddress: vault.address,
      ToAddress: 'Reserve_Base',
      Data: { Function: 'Register()', RecoveryAddress: recovery.address },
    });
    expect(result.fundingHash).toBe(funding.Hash);
    expect(result.registrationHash).toBe(registration.Hash);
  });

  test('a funding that never lands times out naming the funding hash, without registering', async () => {
    const { calls } = install([0]);
    await expect(
      new VfxClient('testnet').fundAndRegisterVault(funder, vault, {
        recoveryAddress: recovery.address,
        pollIntervalMs: 1,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/has not reached/);
    expect(sends(calls)).toHaveLength(1);
  });

  test('refuses an amount that cannot cover the activation', async () => {
    await expect(
      new VfxClient('testnet').fundAndRegisterVault(funder, vault, { recoveryAddress: recovery.address, amount: 4 }),
    ).rejects.toThrow(/at least 4.5 VFX/);
  });
});
