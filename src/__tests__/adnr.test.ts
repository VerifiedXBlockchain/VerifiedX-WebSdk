import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network, TxType } from '../constants';
import { CapturedCall, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const RECIPIENT = 'xRecipient00000000000000000000000';

function addressRecord(address: string, adnr: string | null) {
  return { address, balance: 10, balance_total: 10, balance_locked: 0, adnr, activated: false };
}

function installPipeline(overrides: Record<string, () => unknown> = {}): { calls: CapturedCall[] } {
  return installFetch({
    [`/addresses/${keypair.address}`]: () => addressRecord(keypair.address, 'mine.vfx'),
    [`/addresses/${RECIPIENT}`]: () => jsonResponse({ detail: 'not found' }, 404),
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

let client: VfxClient;

beforeEach(() => {
  client = new VfxClient('testnet');
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('transferVfxDomain', () => {
  test('sends 5 VFX to the recipient with the owned name, after checking both sides', async () => {
    const { calls } = installPipeline();
    const hash = await client.transferVfxDomain(keypair, RECIPIENT);
    expect(hash).toBe('TX_HASH_ABC');

    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.Adnr);
    expect(tx.ToAddress).toBe(RECIPIENT);
    expect(tx.Amount).toBe(5);
    expect(tx.Data).toEqual({ Function: 'AdnrTransfer()', Name: 'mine' });
  });

  test('refuses when the sender has no domain or the recipient already has one', async () => {
    installPipeline({ [`/addresses/${keypair.address}`]: () => addressRecord(keypair.address, null) });
    await expect(client.transferVfxDomain(keypair, RECIPIENT)).rejects.toThrow(/does not own a .vfx domain/);

    installPipeline({ [`/addresses/${RECIPIENT}`]: () => addressRecord(RECIPIENT, 'theirs.vfx') });
    await expect(client.transferVfxDomain(keypair, RECIPIENT)).rejects.toThrow(/already has a domain: theirs.vfx/);
  });

  test('an outage while checking ownership fails the call instead of reading as "no domain"', async () => {
    installPipeline({ [`/addresses/${keypair.address}`]: () => jsonResponse({}, 500) });
    await expect(client.transferVfxDomain(keypair, RECIPIENT)).rejects.toThrow(/500/);
  });

  test('rejects self-transfer before any request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(client.transferVfxDomain(keypair, keypair.address)).rejects.toThrow(/other than the sender/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteVfxDomain', () => {
  test('sends 5 VFX to Adnr_Base with the owned name', async () => {
    const { calls } = installPipeline();
    await client.deleteVfxDomain(keypair);
    const tx = sentTransaction(calls);
    expect(tx.ToAddress).toBe('Adnr_Base');
    expect(tx.Amount).toBe(5);
    expect(tx.Data).toEqual({ Function: 'AdnrDelete()', Name: 'mine' });
  });
});

describe('BTC domain transfer and delete', () => {
  test('transferBtcDomain is addressed to the new managing VFX account and names both BTC addresses', async () => {
    const { calls } = installPipeline();
    await client.transferBtcDomain(keypair, {
      btcFromAddress: 'bc1qfrom',
      btcToAddress: 'bc1qto',
      vfxToAddress: RECIPIENT,
    });
    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.Adnr);
    expect(tx.ToAddress).toBe(RECIPIENT);
    expect(tx.Amount).toBe(5);
    expect(tx.Data).toEqual({ Function: 'BTCAdnrTransfer()', BTCToAddress: 'bc1qto', BTCFromAddress: 'bc1qfrom' });
    // No ownership pre-check for BTC domains: the node validates the pairing.
    expect(calls.some((c) => c.url.includes('/addresses/'))).toBe(false);
  });

  test('deleteBtcDomain goes to Adnr_Base', async () => {
    const { calls } = installPipeline();
    await client.deleteBtcDomain(keypair, { btcFromAddress: 'bc1qfrom' });
    const tx = sentTransaction(calls);
    expect(tx.ToAddress).toBe('Adnr_Base');
    expect(tx.Amount).toBe(5);
    expect(tx.Data).toEqual({ Function: 'BTCAdnrDelete()', BTCFromAddress: 'bc1qfrom' });
  });

  test('missing parameters fail before any request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      client.transferBtcDomain(keypair, { btcFromAddress: '', btcToAddress: 'b', vfxToAddress: 'v' }),
    ).rejects.toThrow(/requires/);
    await expect(client.deleteBtcDomain(keypair, { btcFromAddress: '' })).rejects.toThrow(/requires/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
