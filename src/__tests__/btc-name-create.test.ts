/**
 * buyBtcDomain's Bitcoin-signed message (Core 9.0.1 `BtcNameSignerOwnsAddressHeight`):
 * when the next block is at or past the network's height, the Bitcoin key signs
 * `<unix seconds>:<sender VFX address>:<name>.btc` (Core `BtcNameSignatures.Check`
 * against `Name + ".btc"`); below it, the bare timestamp. The tx data's `Name`
 * never carries the suffix.
 */
import crypto from 'crypto';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {
  BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET,
  BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET,
  VfxClient,
  btcNameSignedMessagesActive,
} from '../index';
import KeypairService from '../services/keypair-service';
import BtcClient from '../btc';
import { Network } from '../constants';
import { CapturedCall, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const PRIVATE_KEY = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const BTC_PRIVATE_KEY = crypto.createHash('sha256').update('btc-name-create-test').digest('hex');
const NOW = 1_800_000_000;

function keypairFor(network: Network) {
  const service = new KeypairService(network);
  return {
    privateKey: PRIVATE_KEY,
    publicKey: service.publicFromPrivate(PRIVATE_KEY),
    address: service.addressFromPrivate(PRIVATE_KEY),
  };
}

/** Whether `signature` (`<DER hex>.<pubkey hex>`) signs hash256(message), as Core's SignatureService checks. */
function verifies(message: string, signature: string): boolean {
  const [derHex, pubKeyHex] = signature.split('.');
  const { signature: compact } = bitcoin.script.signature.decode(
    Buffer.concat([Buffer.from(derHex, 'hex'), Buffer.from([0x01])]),
  );
  const hash = bitcoin.crypto.hash256(Buffer.from(message, 'utf8'));
  return ecc.verify(hash, Buffer.from(pubKeyHex, 'hex'), compact);
}

function installPipeline(latestHeight: () => unknown): { calls: CapturedCall[] } {
  return installFetch({
    '/adnr/': () => jsonResponse({ detail: 'not found' }, 404),
    '/blocks/': latestHeight,
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
  });
}

function tipAt(height: number) {
  return () => ({ count: 1, page: 1, num_pages: 1, results: [{ height }] });
}

function hashedData(calls: CapturedCall[]): Record<string, string> {
  const body = calls.find((call) => call.url.includes('/raw/hash/'))?.body as
    | { transaction: { Data: Record<string, string> } }
    | undefined;
  if (!body) throw new Error('no /raw/hash/ call captured');
  return body.transaction.Data;
}

let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

describe('btcNameSignedMessagesActive', () => {
  test('heights match Core 9.0.1 and the GUI', () => {
    expect(BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET).toBe(7400);
    expect(BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET).toBe(7_575_250);
  });

  test.each([
    [Network.Testnet, 7398, false],
    [Network.Testnet, 7399, true],
    [Network.Testnet, 7400, true],
    [Network.Mainnet, 7_575_248, false],
    [Network.Mainnet, 7_575_249, true],
    [Network.Mainnet, 7_575_250, true],
  ])('%s with latest block %d: %s (it is the next block that counts)', (network, latest, active) => {
    expect(btcNameSignedMessagesActive(network, latest)).toBe(active);
  });
});

describe('buyBtcDomain', () => {
  test.each([
    [Network.Testnet, BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET],
    [Network.Mainnet, BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET],
  ])('%s: below the height it signs the bare timestamp', async (network, height) => {
    const { calls } = installPipeline(tipAt(height - 2));
    const client = new VfxClient(network, { dryRun: true });
    await client.buyBtcDomain(keypairFor(network), 'Alice', BTC_PRIVATE_KEY);

    const data = hashedData(calls);
    expect(data.Message).toBe(`${NOW}`);
    expect(verifies(data.Message, data.Signature)).toBe(true);
    expect(data.Name).toBe('alice');
  });

  test.each([
    [Network.Testnet, BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET - 1],
    [Network.Testnet, BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET + 500],
    [Network.Mainnet, BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET - 1],
  ])('%s with latest block %d: signs <timestamp>:<owner>:<name>.btc with the address key', async (network, latest) => {
    const { calls } = installPipeline(tipAt(latest));
    const keypair = keypairFor(network);
    const client = new VfxClient(network, { dryRun: true });
    await client.buyBtcDomain(keypair, 'Alice.btc', BTC_PRIVATE_KEY);

    const btcAddress = new BtcClient(network).addressFromPrivate(BTC_PRIVATE_KEY).address;
    const data = hashedData(calls);
    expect(data).toEqual({
      Function: 'BTCAdnrCreate()',
      Name: 'alice',
      BTCAddress: btcAddress,
      Message: `${NOW}:${keypair.address}:alice.btc`,
      Signature: data.Signature,
    });
    expect(verifies(data.Message, data.Signature)).toBe(true);
    const expectedPubKey = ecc.pointFromScalar(Buffer.from(BTC_PRIVATE_KEY, 'hex'));
    expect(data.Signature.split('.')[1]).toBe(Buffer.from(expectedPubKey as Uint8Array).toString('hex'));
  });

  test('fails with a clear error, before building, when the latest height cannot be read', async () => {
    const { calls } = installPipeline(() => jsonResponse({ detail: 'down' }, 503));
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.buyBtcDomain(keypairFor(Network.Testnet), 'alice', BTC_PRIVATE_KEY)).rejects.toThrow(
      /buyBtcDomain: could not read the latest block height/,
    );
    expect(calls.some((call) => call.url.includes('/raw/'))).toBe(false);
  });

  test('fails when Spyglass returns no block', async () => {
    installPipeline(() => ({ count: 0, results: [] }));
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.buyBtcDomain(keypairFor(Network.Testnet), 'alice', BTC_PRIVATE_KEY)).rejects.toThrow(
      /could not read the latest block height/,
    );
  });
});
