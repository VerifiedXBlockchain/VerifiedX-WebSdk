/**
 * Every send path shares one contract: a failure before the transaction
 * reaches the node is a clean error (or null), while a failure once the send
 * request has gone out throws TransactionDispatchError carrying the hash,
 * because the node may have accepted it.
 */
import { TransactionDispatchError, VbtcWithdrawalUnrecordedError, VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { FetchHandler, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const address = keypairService.addressFromPrivate(privateKey);
const keypair = { privateKey, publicKey: keypairService.publicFromPrivate(privateKey), address };
const RECIPIENT = 'xRecipient00000000000000000000000';

const lostResponse: FetchHandler = () => {
  throw new TypeError('fetch failed');
};
// Spyglass answers 500 both when the node refuses and when its own call to
// the node times out, so the status alone cannot say the transaction was not
// accepted.
const gatewayError: FetchHandler = () => jsonResponse({ success: false, message: 'Read timed out.' }, 500);

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.resetAllMocks();
});

type VbtcSendCase = {
  name: string;
  prepare: string;
  send: string;
  extra?: Record<string, FetchHandler>;
  run: (client: VfxClient) => Promise<unknown>;
};

const vbtcCases: VbtcSendCase[] = [
  {
    name: 'transferVbtc',
    prepare: '/btc/vbtc-v2/transfer/prepare/',
    send: '/btc/vbtc-v2/transfer/send/',
    run: (client) =>
      client.transferVbtc({
        scIdentifier: 'sc-1',
        fromAddress: address,
        toAddress: RECIPIENT,
        amount: 0.5,
        privateKey,
      }),
  },
  {
    name: 'transferVbtcMulti (one contract covers it)',
    prepare: '/btc/vbtc-v2/transfer/prepare/',
    send: '/btc/vbtc-v2/transfer/send/',
    run: (client) =>
      client.transferVbtcMulti({
        toAddress: RECIPIENT,
        totalAmount: 0.5,
        privateKey,
        inputs: [{ scIdentifier: 'sc-1', amount: 0.5 }],
      }),
  },
  {
    name: 'requestWithdrawal',
    prepare: '/btc/vbtc-v2/withdraw/request/prepare/',
    send: '/btc/vbtc-v2/withdraw/request/send/',
    run: (client) =>
      client.requestWithdrawal({
        scIdentifier: 'sc-1',
        requestorAddress: address,
        btcAddress: 'bc1qBTC',
        amount: 0.001,
        feeRate: 10,
        privateKey,
      }),
  },
  {
    name: 'recordWithdrawalCompletion',
    prepare: '/btc/vbtc-v2/withdraw/complete/tx/prepare/',
    send: '/btc/vbtc-v2/withdraw/complete/tx/send/',
    run: (client) =>
      client.recordWithdrawalCompletion({
        scIdentifier: 'sc-1',
        requestorAddress: address,
        withdrawalRequestHash: 'WR_HASH',
        btcTransactionHash: 'BTC_TXID',
        amount: 0.001,
        btcDestination: 'bc1qBTC',
        privateKey,
      }),
  },
  {
    name: 'cancelWithdrawal',
    prepare: '/btc/vbtc-v2/withdraw/cancel/prepare/',
    send: '/btc/vbtc-v2/withdraw/cancel/send/',
    run: (client) =>
      client.cancelWithdrawal({
        scIdentifier: 'sc-1',
        ownerAddress: address,
        withdrawalRequestHash: 'WR_HASH',
        privateKey,
      }),
  },
  {
    name: 'createVbtcToken',
    prepare: '/btc/vbtc-v2/create/prepare/',
    send: '/btc/vbtc-v2/create/send/',
    extra: {
      '/btc/vbtc-v2/ceremony/prepare/': () => ({
        success: true,
        ceremony_id: 'CER_1',
        session_id: 'SES_1',
        messages_to_sign: {
          start_message: 'START',
          start_timestamp: 1,
          share_distribution_message: 'SHARE',
          share_distribution_timestamp: 2,
        },
      }),
      '/btc/vbtc-v2/ceremony/execute/': () => ({ success: true }),
      '/btc/vbtc-v2/ceremony/CER_1/': () => ({ success: true, status: 'Completed', progress: 100 }),
    },
    run: (client) =>
      client.createVbtcToken({
        ownerAddress: address,
        privateKey,
        name: 'T',
        description: 'd',
        ticker: 'T',
        pollIntervalMs: 1,
      }),
  },
];

describe.each(vbtcCases)('$name', ({ prepare, send, extra, run }) => {
  function install(sendHandler: FetchHandler, prepareHandler?: FetchHandler) {
    return installFetch({
      ...extra,
      [prepare]: prepareHandler ?? (() => ({ success: true, Hash: 'PREPARED_HASH', Fee: 0 })),
      [send]: sendHandler,
    });
  }

  test('a lost response after the send went out throws TransactionDispatchError with the hash', async () => {
    const { calls } = install(lostResponse);
    const error = await run(new VfxClient('testnet')).catch((e) => e);

    expect(error).toBeInstanceOf(TransactionDispatchError);
    expect(error).toMatchObject({ name: 'TransactionDispatchError', hash: 'PREPARED_HASH' });
    expect((error as TransactionDispatchError).cause).toBeInstanceOf(TypeError);
    // One send, no retry inside the SDK.
    expect(calls.filter((c) => c.url.includes(send))).toHaveLength(1);
  });

  test('an error status from the send endpoint is also ambiguous', async () => {
    install(gatewayError);
    await expect(run(new VfxClient('testnet'))).rejects.toMatchObject({
      name: 'TransactionDispatchError',
      hash: 'PREPARED_HASH',
      cause: expect.objectContaining({ name: 'VfxApiError', status: 500 }),
    });
  });

  test('an explicit refusal in a 200 body stays a plain error', async () => {
    install(() => ({ success: false, message: 'refused' }));
    const error = await run(new VfxClient('testnet')).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TransactionDispatchError);
    expect((error as Error).message).toMatch(/:send failed/);
  });

  test('a prepare failure stays a plain error and nothing is sent', async () => {
    const { calls } = install(
      () => ({ success: true, Hash: 'SENT' }),
      () => jsonResponse({ success: false, message: 'nope' }, 500),
    );
    const error = await run(new VfxClient('testnet')).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TransactionDispatchError);
    expect(calls.some((c) => c.url.includes(send))).toBe(false);
  });
});

describe('completeWithdrawal record step', () => {
  test('an ambiguous Type 28 send keeps the do-not-re-sign error and carries the dispatch error as its cause', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: true,
        SessionId: 'S',
        StartMessage: 'START',
        StartTimestamp: 1,
        ShareDistributionMessage: 'SHARE',
        ShareDistributionTimestamp: 2,
      }),
      '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_1' }),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_1/': () => ({
        success: true,
        status: 'complete',
        signed_btc_tx_hex: '0200000001abcd',
      }),
      '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID_123' }),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: true, Hash: 'COMP_HASH', Fee: 0 }),
      '/btc/vbtc-v2/withdraw/complete/tx/send/': lostResponse,
    });

    const error = await new VfxClient('testnet')
      .completeWithdrawal({
        scIdentifier: 'sc-1',
        requestorAddress: address,
        withdrawalRequestHash: 'WR_HASH',
        btcAddress: 'bc1qBTC',
        amount: 0.001,
        feeRate: 10,
        privateKey,
        pollIntervalMs: 1,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(VbtcWithdrawalUnrecordedError);
    expect(error).toMatchObject({ btcTransactionHash: 'BTC_TXID_123', withdrawalRequestHash: 'WR_HASH' });
    expect((error as VbtcWithdrawalUnrecordedError).cause).toBeInstanceOf(TransactionDispatchError);
    expect((error as VbtcWithdrawalUnrecordedError).cause).toMatchObject({ hash: 'COMP_HASH' });
  });
});

describe('raw-transaction send paths', () => {
  const rawPipeline: Record<string, FetchHandler> = {
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': () => ({ Result: 'Success', Hash: 'RAW_HASH' }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
  };

  const rawCases: Array<{ name: string; run: (client: VfxClient) => Promise<unknown> }> = [
    { name: 'sendCoin', run: (client) => client.sendCoin(keypair, RECIPIENT, 1) },
    {
      name: 'transferVbtcMulti (several contracts)',
      run: (client) =>
        client.transferVbtcMulti({
          toAddress: RECIPIENT,
          totalAmount: 1,
          privateKey,
          inputs: [
            { scIdentifier: 'x1', amount: 0.5 },
            { scIdentifier: 'x2', amount: 0.5 },
          ],
        }),
    },
    {
      name: 'transferToken',
      run: (client) =>
        client.transferToken(keypair, { scIdentifier: 'sc', toAddress: RECIPIENT, amount: 1, ticker: 'T', name: 'T' }),
    },
  ];

  test.each(rawCases)('$name surfaces a lost send response as TransactionDispatchError', async ({ run }) => {
    const { calls } = installFetch({ ...rawPipeline, '/raw/send/': lostResponse });
    await expect(run(new VfxClient('testnet'))).rejects.toMatchObject({
      name: 'TransactionDispatchError',
      hash: 'RAW_HASH',
    });
    expect(calls.filter((c) => c.url.includes('/raw/send/'))).toHaveLength(1);
  });

  test('a pre-dispatch failure is still a clean failure for transferVbtcMulti', async () => {
    const { calls } = installFetch({ ...rawPipeline, '/raw/verify/': () => ({ Result: 'Failure' }) });
    const error = await new VfxClient('testnet')
      .transferVbtcMulti({
        toAddress: RECIPIENT,
        totalAmount: 1,
        privateKey,
        inputs: [
          { scIdentifier: 'x1', amount: 0.5 },
          { scIdentifier: 'x2', amount: 0.5 },
        ],
      })
      .catch((e) => e);
    expect(error).not.toBeInstanceOf(TransactionDispatchError);
    expect((error as Error).message).toMatch(/rejected before it reached the node/);
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });
});
