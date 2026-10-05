import EC from 'elliptic';
import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network, RESERVE_ACTIVATION_COST, RESERVE_BASE_ADDRESS, TxType } from '../constants';
import { CapturedCall, installFetch, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const mainPrivateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const main = {
  privateKey: mainPrivateKey,
  publicKey: keypairService.publicFromPrivate(mainPrivateKey),
  address: keypairService.addressFromPrivate(mainPrivateKey),
};
const vault = keypairService.reserveKeypairFromPrivateKey(mainPrivateKey);
const RECIPIENT = 'xRecipient00000000000000000000000';
const SC = 'abc123:1700000000';

function installPipeline(overrides: Record<string, (url: string, init?: RequestInit) => unknown> = {}): {
  calls: CapturedCall[];
} {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
    ...overrides,
  });
}

function sentTransaction(calls: CapturedCall[]): Record<string, unknown> {
  const send = calls.find((c) => c.url.includes('/raw/send/'));
  if (!send) throw new Error('no /raw/send/ call captured');
  return (send.body as { transaction: Record<string, unknown> }).transaction;
}

/** HSM stand-in holding the vault key, presenting the xRBX address. */
function vaultSigner() {
  const curve = new EC.ec('secp256k1');
  const priv = vault.privateKey.slice(2);
  return {
    address: vault.address,
    publicKey: vault.publicKey,
    signDigest: (digestHex: string): Uint8Array =>
      Uint8Array.from(
        curve.keyFromPrivate(Buffer.from(priv, 'hex')).sign(Buffer.from(digestHex, 'hex'), { canonical: true }).toDER(),
      ),
  };
}

let client: VfxClient;
let now: number;

beforeEach(() => {
  client = new VfxClient('testnet');
  now = Math.round(Date.now() / 1000);
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('reserve keypair helpers on the client', () => {
  test('derive the same vault as KeypairService and expose the xRBX address', () => {
    expect(client.reserveKeypairFromPrivateKey(mainPrivateKey)).toEqual(vault);
    expect(vault.address.startsWith('xRBX')).toBe(true);
    expect(client.reserveKeypairFromRestoreCode(vault.restoreCode)).toEqual(vault);
    expect(client.reserveKeypairFromReservePrivateKey(vault.privateKey)).toEqual(vault);
    expect(client.reserveAddressFromPublic(vault.publicKey)).toBe(vault.address);
    expect(client.generateReserveKeypair().address.startsWith('xRBX')).toBe(true);
  });
});

describe('registerReserveAccount', () => {
  test('sends 4 VFX to Reserve_Base from the vault naming its recovery address', async () => {
    const { calls } = installPipeline();
    const hash = await client.registerReserveAccount(vault);
    expect(hash).toBe('TX_HASH_ABC');

    // Nonce and signature validation are against the xRBX address.
    expect(calls[1].url).toContain(`/raw/nonce/${vault.address}/`);
    expect(calls[4].url).toContain(`/${vault.address}/`);

    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.Reserve);
    expect(tx.ToAddress).toBe(RESERVE_BASE_ADDRESS);
    expect(tx.FromAddress).toBe(vault.address);
    expect(tx.Amount).toBe(RESERVE_ACTIVATION_COST);
    expect(tx.UnlockTime).toBeNull();
    expect(tx.Data).toEqual({ Function: 'Register()', RecoveryAddress: vault.recoveryAddress });
    expect(tx.Signature).toBe(keypairService.getSignature('TX_HASH_ABC', vault.privateKey));
  });

  test('an external vault signer works with an explicit recovery address', async () => {
    const { calls } = installPipeline();
    await client.registerReserveAccount(vaultSigner(), { recoveryAddress: vault.recoveryAddress });
    const tx = sentTransaction(calls);
    expect(tx.FromAddress).toBe(vault.address);
    expect(tx.Signature).toBe(keypairService.getSignature('TX_HASH_ABC', vault.privateKey));
  });

  test('refuses an ordinary account, a missing recovery address, and a reserve recovery address', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(client.registerReserveAccount(main)).rejects.toThrow(/must be signed by a reserve/);
    await expect(client.registerReserveAccount(vaultSigner())).rejects.toThrow(/requires a recoveryAddress/);
    await expect(client.registerReserveAccount(vault, { recoveryAddress: vault.address })).rejects.toThrow(
      /ordinary account/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sends from a reserve account carry an unlock time', () => {
  test('sendCoin defaults to 24 hours and honours a longer delay', async () => {
    const { calls } = installPipeline();
    await client.sendCoin(vault, RECIPIENT, 1.5);
    let tx = sentTransaction(calls);
    expect(tx.FromAddress).toBe(vault.address);
    expect(tx.UnlockTime as number).toBeGreaterThanOrEqual(now + 24 * 3600);
    expect(tx.UnlockTime as number).toBeLessThanOrEqual(now + 24 * 3600 + 5);

    calls.length = 0;
    await client.sendCoin(vault, RECIPIENT, 1.5, { unlockHours: 48 });
    tx = sentTransaction(calls);
    expect(tx.UnlockTime as number).toBeGreaterThanOrEqual(now + 48 * 3600);
  });

  test('a delay under 24 hours, or a delay on an ordinary account, is refused before any request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(client.sendCoin(vault, RECIPIENT, 1, { unlockHours: 12 })).rejects.toThrow(/at least 24 hours/);
    await expect(client.sendCoin(main, RECIPIENT, 1, { unlockHours: 24 })).rejects.toThrow(
      /only to sends from a reserve/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an ordinary account still sends with no unlock time', async () => {
    const { calls } = installPipeline();
    await client.sendCoin(main, RECIPIENT, 1);
    expect(sentTransaction(calls).UnlockTime).toBeNull();
  });

  test('token transfers from a vault get the unlock time the node requires', async () => {
    const { calls } = installPipeline();
    await client.transferToken(vault, { scIdentifier: SC, toAddress: RECIPIENT, amount: 1, ticker: 'T', name: 'T' });
    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.TokenTx);
    expect(tx.FromAddress).toBe(vault.address);
    expect(tx.UnlockTime as number).toBeGreaterThanOrEqual(now + 24 * 3600);
  });

  test('what the network does not allow from a vault fails early', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(client.deployToken(vault, { name: 'n', ticker: 'T', initialSupply: 1 })).rejects.toThrow(
      /cannot be sent from a reserve account/,
    );
    await expect(client.buyVfxDomain(vault, 'name.vfx')).rejects.toThrow(/cannot be sent from a reserve account/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('domain management and multi-contract vBTC refuse a vault sender, key or Signer, before any request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const refused = /cannot be sent from a reserve account/;
    for (const sender of [vault, vaultSigner()]) {
      await expect(client.transferVfxDomain(sender, RECIPIENT)).rejects.toThrow(refused);
      await expect(client.deleteVfxDomain(sender)).rejects.toThrow(refused);
      await expect(
        client.transferBtcDomain(sender, {
          btcFromAddress: 'tb1qfrom',
          btcToAddress: 'tb1qto',
          vfxToAddress: RECIPIENT,
        }),
      ).rejects.toThrow(refused);
      await expect(client.deleteBtcDomain(sender, { btcFromAddress: 'tb1qfrom' })).rejects.toThrow(refused);
    }
    await expect(
      client.transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 0.1, signer: vaultSigner() }),
    ).rejects.toThrow(refused);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('callBackReserveTransaction', () => {
  test('sends CallBack() for the pending hash with a zero unlock time', async () => {
    const { calls } = installPipeline();
    await client.callBackReserveTransaction(vault, { hash: 'PENDING_HASH' });
    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.Reserve);
    expect(tx.ToAddress).toBe(RESERVE_BASE_ADDRESS);
    expect(tx.Amount).toBe(0);
    expect(tx.UnlockTime).toBe(0);
    expect(tx.Data).toEqual({ Function: 'CallBack()', Hash: 'PENDING_HASH' });
  });

  test('requires a hash and a vault signer', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(client.callBackReserveTransaction(vault, { hash: '' })).rejects.toThrow(/requires the hash/);
    await expect(client.callBackReserveTransaction(main, { hash: 'x' })).rejects.toThrow(/must be signed by a reserve/);
  });
});

describe('recoverReserveAccount', () => {
  test('signs the transaction with the vault key and the sig script with the recovery key', async () => {
    const { calls } = installPipeline();
    await client.recoverReserveAccount(vault);
    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.Reserve);
    expect(tx.Amount).toBe(0);
    expect(tx.UnlockTime).toBe(0);
    expect(tx.Signature).toBe(keypairService.getSignature('TX_HASH_ABC', vault.privateKey));

    const data = tx.Data as {
      Function: string;
      RecoveryAddress: string;
      RecoverySigScript: string;
      SignatureTime: number;
    };
    expect(data.Function).toBe('Recover()');
    expect(data.RecoveryAddress).toBe(vault.recoveryAddress);
    expect(data.SignatureTime).toBeGreaterThanOrEqual(now);
    expect(data.SignatureTime).toBeLessThanOrEqual(now + 5);
    expect(data.RecoverySigScript).toBe(
      keypairService.getSignature(`${data.SignatureTime}${vault.recoveryAddress}`, vault.recoveryPrivateKey),
    );
  });

  test('a vault Signer plus a separate recovery keypair works', async () => {
    const { calls } = installPipeline();
    const recovery = {
      privateKey: vault.recoveryPrivateKey,
      publicKey: vault.recoveryPublicKey,
      address: vault.recoveryAddress,
    };
    await client.recoverReserveAccount(vaultSigner(), { recoverySigner: recovery });
    const data = sentTransaction(calls).Data as {
      RecoveryAddress: string;
      RecoverySigScript: string;
      SignatureTime: number;
    };
    expect(data.RecoveryAddress).toBe(vault.recoveryAddress);
    expect(data.RecoverySigScript).toBe(
      keypairService.getSignature(`${data.SignatureTime}${vault.recoveryAddress}`, vault.recoveryPrivateKey),
    );
  });

  test('refuses a missing recovery signer or one that does not own the stated recovery address', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(client.recoverReserveAccount(vaultSigner())).rejects.toThrow(/requires a recoverySigner/);
    await expect(client.recoverReserveAccount(vault, { recoveryAddress: main.address })).rejects.toThrow(
      /signs for .* not the recoveryAddress/,
    );
  });
});

describe('getAddressDetails exposes reserve activation state', () => {
  test('maps activated and deactivated', async () => {
    installFetch({
      [`/addresses/${vault.address}`]: () => ({
        address: vault.address,
        balance: 10,
        balance_total: 12,
        balance_locked: 2,
        adnr: null,
        activated: true,
        deactivated: false,
      }),
    });
    const details = await client.getAddressDetails(vault.address);
    expect(details?.activated).toBe(true);
    expect(details?.deactivated).toBe(false);
    expect(details?.balanceLocked).toBe(2);
  });
});
