/**
 * Cross-wallet BTC name transfer acceptance (Core `BtcNameSignatures`, from
 * `BtcNameSignerOwnsAddressHeight`): the receiving Bitcoin key signs
 * `<unix seconds>:<new VFX owner>:<name>.btc`, handed to the sender as
 * `<message>|<signature>`, and the transfer carries it as
 * `BTCToMessage`/`BTCToSignature`.
 */
import crypto from 'crypto';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { VfxClient, btcNameAcceptanceMessage, buildBtcNameAcceptanceCode, parseBtcNameAcceptanceCode } from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { CapturedCall, installFetch, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const NEW_OWNER = keypairService.addressFromPrivate('22'.repeat(32));
const BTC_PRIVATE_KEY = crypto.createHash('sha256').update('btc-name-acceptance-test').digest('hex');
const NOW = 1_800_000_000;

/** Whether `signature` (`<DER hex>.<pubkey hex>`) signs hash256(message), as Core's SignatureService checks. */
function verifies(message: string, signature: string): boolean {
  const [derHex, pubKeyHex] = signature.split('.');
  const { signature: compact } = bitcoin.script.signature.decode(
    Buffer.concat([Buffer.from(derHex, 'hex'), Buffer.from([0x01])]),
  );
  const hash = bitcoin.crypto.hash256(Buffer.from(message, 'utf8'));
  return ecc.verify(hash, Buffer.from(pubKeyHex, 'hex'), compact);
}

describe('acceptance message and code', () => {
  test('the message is <timestamp>:<owner>:<name>.btc with the name lowercased', () => {
    expect(btcNameAcceptanceMessage(NOW, ` ${NEW_OWNER} `, 'Alice')).toBe(`${NOW}:${NEW_OWNER}:alice.btc`);
    expect(btcNameAcceptanceMessage(NOW, NEW_OWNER, 'alice.BTC')).toBe(`${NOW}:${NEW_OWNER}:alice.btc`);
  });

  test('a code round-trips through build and parse', () => {
    const message = btcNameAcceptanceMessage(NOW, NEW_OWNER, 'alice');
    const code = buildBtcNameAcceptanceCode(message, 'DERHEX.PUBKEY');
    expect(parseBtcNameAcceptanceCode(`  ${code}\n`)).toEqual({
      message,
      signature: 'DERHEX.PUBKEY',
      timestamp: NOW,
      owner: NEW_OWNER,
      name: 'alice.btc',
    });
  });

  test.each([
    ['empty', ''],
    ['no separator', `${NOW}:${NEW_OWNER}:alice.btc`],
    ['no signature', `${NOW}:${NEW_OWNER}:alice.btc|`],
    ['signature without a public key', `${NOW}:${NEW_OWNER}:alice.btc|DERHEX`],
    ['two separators', `${NOW}:${NEW_OWNER}:alice.btc|DER.PUB|x`],
    ['two message parts', `${NOW}:alice.btc|DER.PUB`],
    ['non-numeric timestamp', `soon:${NEW_OWNER}:alice.btc|DER.PUB`],
    ['zero timestamp', `0:${NEW_OWNER}:alice.btc|DER.PUB`],
  ])('parse refuses a code with %s', (_, code) => {
    expect(parseBtcNameAcceptanceCode(code)).toBeNull();
  });
});

describe('signBtcNameTransferAcceptance', () => {
  test("signs with the receiving Bitcoin key in Core's format", () => {
    const client = new VfxClient('testnet');
    const accepted = client.signBtcNameTransferAcceptance({
      btcPrivateKey: BTC_PRIVATE_KEY,
      name: 'Alice',
      newOwner: NEW_OWNER,
      timestamp: NOW,
    });
    expect(accepted.message).toBe(`${NOW}:${NEW_OWNER}:alice.btc`);
    expect(accepted.code).toBe(`${accepted.message}|${accepted.signature}`);
    expect(verifies(accepted.message, accepted.signature)).toBe(true);
    expect(verifies(`${NOW}:${NEW_OWNER}:bob.btc`, accepted.signature)).toBe(false);
    const signerPubKey = accepted.signature.split('.')[1];
    const expectedPubKey = ecc.pointFromScalar(Buffer.from(BTC_PRIVATE_KEY, 'hex'));
    expect(expectedPubKey).not.toBeNull();
    expect(signerPubKey).toBe(Buffer.from(expectedPubKey as Uint8Array).toString('hex'));
  });
});

describe('transferBtcDomain with an acceptance', () => {
  function installPipeline(): { calls: CapturedCall[] } {
    return installFetch({
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
    });
  }

  function hashedData(calls: CapturedCall[]): Record<string, unknown> | undefined {
    const body = calls.find((call) => call.url.includes('/raw/hash/'))?.body as
      | { transaction: { Data: Record<string, unknown> } }
      | undefined;
    return body?.transaction.Data;
  }

  const base = { btcFromAddress: 'tb1qfrom', btcToAddress: 'tb1qto', vfxToAddress: NEW_OWNER };

  let consoleErrorSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.resetAllMocks();
  });

  test('carries BTCToMessage and BTCToSignature when given', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    const accepted = client.signBtcNameTransferAcceptance({
      btcPrivateKey: BTC_PRIVATE_KEY,
      name: 'alice',
      newOwner: NEW_OWNER,
    });
    const parsed = parseBtcNameAcceptanceCode(accepted.code);
    expect(parsed).not.toBeNull();
    await client.transferBtcDomain(keypair, {
      ...base,
      btcToMessage: parsed?.message,
      btcToSignature: parsed?.signature,
    });
    expect(hashedData(calls)).toEqual({
      Function: 'BTCAdnrTransfer()',
      BTCToAddress: 'tb1qto',
      BTCFromAddress: 'tb1qfrom',
      BTCToMessage: accepted.message,
      BTCToSignature: accepted.signature,
    });
  });

  test('without an acceptance the payload is unchanged', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await client.transferBtcDomain(keypair, base);
    expect(hashedData(calls)).toEqual({
      Function: 'BTCAdnrTransfer()',
      BTCToAddress: 'tb1qto',
      BTCFromAddress: 'tb1qfrom',
    });
  });

  test('refuses one half of the pair', async () => {
    installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.transferBtcDomain(keypair, { ...base, btcToMessage: 'm' })).rejects.toThrow(/together/);
  });

  test('refuses an acceptance for another owner, or one over 24 hours old, before building', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet', { dryRun: true });
    const now = Math.floor(Date.now() / 1000);
    await expect(
      client.transferBtcDomain(keypair, {
        ...base,
        btcToMessage: btcNameAcceptanceMessage(now, keypair.address, 'alice'),
        btcToSignature: 'DER.PUB',
      }),
    ).rejects.toThrow(/names .* as the new owner/);
    await expect(
      client.transferBtcDomain(keypair, {
        ...base,
        btcToMessage: btcNameAcceptanceMessage(now - 24 * 60 * 60 - 60, NEW_OWNER, 'alice'),
        btcToSignature: 'DER.PUB',
      }),
    ).rejects.toThrow(/more than 24 hours old/);
    expect(calls).toHaveLength(0);
  });
});
