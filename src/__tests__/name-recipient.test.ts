/**
 * From PathAuditRulesHeight the node refuses a transaction addressed to a
 * `.vfx`/`.rbx` name (Core `LedgerIntegrityRules.RecipientIsNotAName`): the
 * ledger would credit the name string itself. The client resolves the name
 * through Spyglass and sends to the address it names.
 */
import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { RawTransactionService } from '../services/raw-transaction-service';
import { Network } from '../constants';
import { CapturedCall, FetchHandler, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const NAMED = keypairService.addressFromPrivate('11'.repeat(32));

function installPipeline(extra: Record<string, FetchHandler> = {}): { calls: CapturedCall[] } {
  return installFetch({
    '/addresses/adnr/someone.vfx/': () => ({ address: NAMED, domain: 'someone.vfx' }),
    '/addresses/adnr/ghost.vfx/': () => jsonResponse({ detail: 'not found' }, 404),
    '/addresses/adnr/': () => jsonResponse({ detail: 'down' }, 503),
    [`/addresses/${NAMED}`]: () => ({
      address: NAMED,
      balance: 1,
      balance_total: 1,
      balance_locked: 0,
      adnr: 'someone.vfx',
      activated: false,
    }),
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
    ...extra,
  });
}

function hashedTx(calls: CapturedCall[]): Record<string, unknown> | undefined {
  const body = calls.find((call) => call.url.includes('/raw/hash/'))?.body as
    | { transaction: Record<string, unknown> }
    | undefined;
  return body?.transaction;
}

function hashedToAddress(calls: CapturedCall[]): unknown {
  return hashedTx(calls)?.ToAddress;
}

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.resetAllMocks();
});

describe('a name recipient is resolved before building', () => {
  test('sendCoin sends to the address the name resolves to', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    expect(await client.sendCoin(keypair, 'someone.vfx', 1)).toBe('TX_HASH_ABC');
    expect(hashedToAddress(calls)).toBe(NAMED);
  });

  test('the name is matched case-insensitively', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await client.sendCoin(keypair, 'SomeOne.VFX', 1);
    expect(hashedToAddress(calls)).toBe(NAMED);
  });

  test('transferToken carries the resolved address in the transaction and its data', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await client.transferToken(keypair, {
      scIdentifier: 'sc-1',
      toAddress: 'someone.vfx',
      amount: 1,
      ticker: 'TKN',
      name: 'Token',
    });
    const hashed = hashedTx(calls);
    expect(hashed?.ToAddress).toBe(NAMED);
    expect(JSON.stringify(hashed?.Data)).toContain(NAMED);
    expect(JSON.stringify(hashed?.Data)).not.toContain('someone.vfx');
  });

  test('transferVbtc asks Spyglass to prepare for the resolved address', async () => {
    const { calls } = installPipeline({
      '/btc/vbtc-v2/transfer/prepare/': () => jsonResponse({ success: false, message: 'stop here' }),
    });
    const client = new VfxClient('testnet');
    await expect(
      client.transferVbtc({
        scIdentifier: 'sc-1',
        fromAddress: keypair.address,
        toAddress: 'someone.vfx',
        amount: 1,
        privateKey,
      }),
    ).rejects.toThrow(/prepare/);
    const prepare = calls.find((call) => call.url.includes('/btc/vbtc-v2/transfer/prepare/'));
    expect(prepare?.body?.to_address).toBe(NAMED);
  });

  test('refuses when the resolved address no longer holds the name (a stale lookup)', async () => {
    const { calls } = installPipeline({
      [`/addresses/${NAMED}`]: () => ({
        address: NAMED,
        balance: 1,
        balance_total: 1,
        balance_locked: 0,
        adnr: 'newname.vfx',
        activated: false,
      }),
    });
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.sendCoin(keypair, 'someone.vfx', 1)).rejects.toThrow(
      /resolved to .* whose own record names newname\.vfx; the name may have just moved/,
    );
    expect(calls.some((call) => call.url.includes('/raw/'))).toBe(false);
  });

  test('the cross-check reads the resolved address itself', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await client.sendCoin(keypair, 'someone.vfx', 1);
    expect(
      calls.some((call) => call.url.endsWith(`/addresses/${NAMED}`) || call.url.includes(`/addresses/${NAMED}/`)),
    ).toBe(true);
  });

  test('an unregistered name fails without building', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.sendCoin(keypair, 'ghost.vfx', 1)).rejects.toThrow(/no account holds the name ghost\.vfx/);
    expect(calls.some((call) => call.url.includes('/raw/'))).toBe(false);
  });

  test('a Spyglass outage fails the call rather than reading as no such name', async () => {
    installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.sendCoin(keypair, 'down.vfx', 1)).rejects.toThrow();
  });

  test('an address is used as given, with no lookup', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await client.sendCoin(keypair, NAMED, 1);
    expect(calls.some((call) => call.url.includes('/adnr/'))).toBe(false);
    expect(hashedToAddress(calls)).toBe(NAMED);
  });

  test('RawTransactionService refuses an unresolved name', () => {
    expect(
      () => new RawTransactionService({ network: Network.Testnet, keypair, toAddress: 'someone.rbx', amount: 1 }),
    ).toThrow(/is a name; send to the address it resolves to/);
  });
});
