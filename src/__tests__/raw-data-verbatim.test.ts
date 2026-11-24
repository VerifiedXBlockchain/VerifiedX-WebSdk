import EC from 'elliptic';
import { Network } from '../constants';
import { RawTransactionService } from '../services/raw-transaction-service';
import KeypairService, { verifySignature } from '../services/keypair-service';
import {
  coreDataString,
  coreDecimalString,
  coreTxTypeName,
  hashPreimage,
  transactionHash,
  transactionHashPreimage,
  verbatimDataString,
  HashableTransaction,
} from '../services/transaction-hash';
import { Signer, SigningRequest } from '../signer';
import { installFetch, textResponse } from './helpers/mock-fetch';

/**
 * From Core's RawDataVerbatimHeight the node hashes Data as it arrives in
 * the request body (an object or array as its exact JSON text, a string as
 * its decoded value) instead of re-serialising it. 'both' mode has to accept
 * the node's hash in either form, and nothing else.
 */

const curve = new EC.ec('secp256k1');
const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const address = keypairService.addressFromPrivate(privateKey);
const publicKey = keypairService.publicFromPrivate(privateKey);
const RECIPIENT = 'xRecipient00000000000000000000000';

type SentTransaction = HashableTransaction & { Hash: string; Signature: string };

/**
 * Data's text exactly as it sits in the request body, read the way the node
 * reads it (`JsonElement.GetRawText()`), independently of the SDK's helper.
 * The SDK writes Height just before Data and UnlockTime just after it.
 */
function rawDataText(body: string): string {
  const start = body.indexOf(',"Height":0,"Data":') + ',"Height":0,"Data":'.length;
  const end = body.lastIndexOf(',"UnlockTime":');
  return body.slice(start, end);
}

/** The Data string a node past RawDataVerbatimHeight hashes, from the request body alone. */
function nodeVerbatimData(body: string): string {
  const raw = rawDataText(body);
  const value: unknown = JSON.parse(raw);
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') return raw;
  return coreDataString(value);
}

/** `/raw/hash` of a node past the height. */
function verbatimNodeHash(body: string): string {
  const tx = (JSON.parse(body) as { transaction: SentTransaction }).transaction;
  const preimage =
    `${tx.Timestamp}${tx.FromAddress}${tx.ToAddress}${coreDecimalString(tx.Amount)}${coreDecimalString(tx.Fee)}` +
    `${tx.Nonce}${coreTxTypeName(tx.TransactionType)}${nodeVerbatimData(body)}` +
    `${tx.UnlockTime === null || tx.UnlockTime === undefined ? '' : tx.UnlockTime}`;
  return hashPreimage(preimage);
}

/** `/raw/hash` of a node below the height (every network today). */
function reserialisedNodeHash(body: string): string {
  return transactionHash((JSON.parse(body) as { transaction: SentTransaction }).transaction);
}

function installNode(hashOf: (body: string) => string) {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/hash/': (_url, init) => ({ Result: 'Success', Hash: hashOf(init?.body as string) }),
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
  });
}

function recordingSigner() {
  const requests: SigningRequest[] = [];
  const signDigest = jest.fn((digestHex: string, request?: SigningRequest) => {
    if (request) requests.push(request);
    return Uint8Array.from(
      curve
        .keyFromPrivate(Buffer.from(privateKey, 'hex'))
        .sign(Buffer.from(digestHex, 'hex'), { canonical: true })
        .toDER(),
    );
  });
  const signer: Signer = { address, publicKey, signDigest };
  return { signer, signDigest, requests };
}

function send(signer: Signer, data: unknown, unlockTime: number | null = null) {
  return new RawTransactionService({
    network: Network.Testnet,
    signer,
    toAddress: RECIPIENT,
    amount: 1.5,
    // String Data is not in the option's type, but JavaScript callers can pass it.
    data: data as Record<string, unknown>,
    unlockTime,
  }).process();
}

const DATA_CASES: Array<[string, unknown]> = [
  [
    'nested objects and arrays',
    {
      Function: 'Note()',
      Outer: { Inner: { List: [1, [2, 3.25e-6], { Deep: true, None: null }] } },
      Empty: {},
      Nil: [],
    },
  ],
  [
    'long decimals and small numbers',
    { Amount: 1234567.12345678, Tiny: 0.00001, Tinier: 1.5e-7, Precise: 0.30000000000000004, Big: 1e21, Whole: 100 },
  ],
  ['unicode and escapes', { Text: 'é ü 日本 😀 "quoted" back\\slash\nline\ttab \u0001 \u2028 \u2029 \u0085 </>' }],
  ['a top-level array', [{ Function: 'Transfer()', Amount: 0.00001, Memo: 'line\u2028break' }]],
  ['a string', 'plain text with "quotes", é and 0.00001'],
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe('verbatimDataString', () => {
  test.each(DATA_CASES)('is the Data text of the request body for %s', async (_name, data) => {
    const { calls } = installNode(reserialisedNodeHash);
    const { signer } = recordingSigner();
    await send(signer, data);
    const hashCall = calls.find((c) => c.url.includes('/raw/hash/'));
    expect(nodeVerbatimData(hashCall?.rawBody as string)).toBe(verbatimDataString(data));
  });

  test('every case differs between the two forms, so each test below tells them apart', () => {
    for (const [, data] of DATA_CASES) {
      expect(verbatimDataString(data)).not.toBe(coreDataString(data));
    }
  });

  test('keeps the text JSON.stringify writes, and a string as itself', () => {
    expect(verbatimDataString({ a: 1e-7, b: 'x\u2028' })).toBe('{"a":1e-7,"b":"x\u2028"}');
    expect(verbatimDataString([1.5, { k: 'v' }])).toBe('[1.5,{"k":"v"}]');
    expect(verbatimDataString('a "b"')).toBe('a "b"');
  });

  test('is null where the node reads Data as before', () => {
    expect(verbatimDataString(null)).toBeNull();
    expect(verbatimDataString(undefined)).toBeNull();
    expect(verbatimDataString(5)).toBeNull();
    expect(verbatimDataString(true)).toBeNull();
  });

  test('the verbatim preimage falls back to the re-serialised form for null Data', () => {
    const tx = {
      Timestamp: 1,
      FromAddress: 'a',
      ToAddress: 'b',
      Amount: 1,
      Fee: 0.00002,
      Nonce: 3,
      TransactionType: 0,
      Data: null,
    };
    expect(transactionHashPreimage(tx, { dataForm: 'verbatim' })).toBe(transactionHashPreimage(tx));
  });
});

describe("'both' accepts the node's hash in either form of Data", () => {
  test.each(DATA_CASES)('a node that re-serialises Data: %s', async (_name, data) => {
    const { calls } = installNode(reserialisedNodeHash);
    const { signer, requests } = recordingSigner();
    const hash = await send(signer, data);

    const sent = calls.find((c) => c.url.includes('/raw/send/'))?.body?.transaction as SentTransaction;
    expect(hash).toBe(transactionHash(sent));
    expect(sent.Hash).toBe(hash);
    const request = requests[0];
    if (request.kind !== 'transaction') throw new Error('expected a transaction request');
    expect(hashPreimage(request.hashPreimage as string)).toBe(hash);
  });

  test.each(DATA_CASES)('a node that keeps Data as sent: %s', async (_name, data) => {
    const { calls } = installNode(verbatimNodeHash);
    const { signer, requests } = recordingSigner();
    const hash = await send(signer, data, 1700003600);

    const sendCall = calls.find((c) => c.url.includes('/raw/send/'));
    const sent = sendCall?.body?.transaction as SentTransaction;
    // Signed and sent over the node's hash, not the re-serialised one.
    expect(hash).toBe(verbatimNodeHash(sendCall?.rawBody as string));
    expect(hash).not.toBe(transactionHash(sent));
    expect(sent.Hash).toBe(hash);
    expect(verifySignature(hash as string, sent.Signature, address)).toBe(true);

    const request = requests[0];
    if (request.kind !== 'transaction') throw new Error('expected a transaction request');
    expect(request.message).toBe(hash);
    expect(hashPreimage(request.hashPreimage as string)).toBe(hash);
    expect(transactionHash(request.transaction, { dataForm: 'verbatim' })).toBe(hash);
  });

  test('Data that reads the same either way hashes the same either way', async () => {
    const data = { Function: 'AdnrCreate()', Name: 'example' };
    expect(verbatimDataString(data)).toBe(coreDataString(data));

    installNode(reserialisedNodeHash);
    const before = await send(recordingSigner().signer, data);
    installNode(verbatimNodeHash);
    const after = await send(recordingSigner().signer, data);
    expect(after).toBe(before);
  });
});

describe("'both' still refuses a hash that matches neither form", () => {
  test.each(DATA_CASES)('%s', async (_name, data) => {
    // The node hashed other Data than the SDK sent, in the verbatim form.
    const { calls } = installNode((body) => {
      const parsed = JSON.parse(body) as { transaction: SentTransaction };
      parsed.transaction.Data = { Other: 'data' };
      return verbatimNodeHash(JSON.stringify(parsed));
    });
    const { signer, signDigest } = recordingSigner();
    await expect(send(signer, data)).rejects.toMatchObject({ name: 'TransactionHashMismatchError' });
    expect(signDigest).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });

  test('an unrelated hash', async () => {
    const { calls } = installNode(() => 'SERVER_SAYS_OTHERWISE');
    const { signer, signDigest } = recordingSigner();
    await expect(send(signer, { Function: 'Note()', Tiny: 0.00001 })).rejects.toMatchObject({
      name: 'TransactionHashMismatchError',
      serverHash: 'SERVER_SAYS_OTHERWISE',
    });
    expect(signDigest).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });
});
