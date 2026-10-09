import * as bitcoin from 'bitcoinjs-lib';
import BtcClient from '../btc/client';
import TransactionService, { classifyBroadcastFailure } from '../btc/transaction';
import { BtcBroadcastUnknownError } from '../btc/errors';
import * as sdk from '../index';
import { FetchHandler, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

// Testnet WIF already used by the signing vectors in btc.test.ts.
const SENDER_WIF = 'cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M';
const RECIPIENT = 'tb1qr0eyx8j8w8u7n4vtvu6ywyk3smkhhexw42zrvm';
const PREV_TXID = 'aa'.repeat(32);
const OTHER_TXID = 'bb'.repeat(32);

const UTXO_HANDLERS: Record<string, FetchHandler> = {
  '/utxo': () => [{ txid: PREV_TXID, vout: 1, value: 100_000, status: { confirmed: true } }],
  '/fees/recommended': () => ({ fastestFee: 30, halfHourFee: 20, hourFee: 10, economyFee: 7, minimumFee: 1 }),
};

async function signedTx(): Promise<{ hex: string; txid: string }> {
  installFetch(UTXO_HANDLERS);
  const created = await new TransactionService(true).createTransaction(SENDER_WIF, RECIPIENT, 0.0005, 10);
  const hex = created.result as string;
  return { hex, txid: bitcoin.Transaction.fromHex(hex).getId() };
}

function rpcError(code: number | string, json = false): string {
  const inner = `sendrawtransaction RPC error: ${JSON.stringify({ code })}`;
  return json ? JSON.stringify({ error: inner }) : inner;
}

afterEach(() => {
  jest.resetAllMocks();
});

describe('classifyBroadcastFailure', () => {
  test.each([
    [400, rpcError(-26), 'refused'],
    [400, rpcError(-25, true), 'refused'],
    [400, rpcError(-22), 'refused'],
    [400, 'sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met"}', 'refused'],
    [400, rpcError(-27), 'already-known'],
    [400, 'sendrawtransaction RPC error: {"code":-26,"message":"txn-already-in-mempool"}', 'already-known'],
    [400, rpcError('ECONNREFUSED'), 'unknown'],
    [400, rpcError(-32603), 'unknown'],
    [400, 'Failed to send raw transaction', 'unknown'],
    [400, '', 'unknown'],
    [500, 'Internal Server Error', 'unknown'],
    [502, '<html>Bad Gateway</html>', 'unknown'],
    [429, 'Too Many Requests', 'refused'],
    [403, 'Forbidden', 'refused'],
    [404, 'Not Found', 'refused'],
  ])('HTTP %i %j -> %s', (status, body, expected) => {
    expect(classifyBroadcastFailure(status, body)).toBe(expected);
  });
});

describe('broadcastTransaction', () => {
  test('returns the txid of the signed transaction on acceptance', async () => {
    const { hex, txid } = await signedTx();
    const { calls } = installFetch({ '/api/tx': () => textResponse(txid) });

    const result = await new TransactionService(true).broadcastTransaction(hex);

    expect(result).toEqual({ success: true, result: txid, error: null });
    expect(calls[0]).toMatchObject({ method: 'POST', rawBody: hex });
  });

  test('throws BtcBroadcastUnknownError with txid and hex when the request fails', async () => {
    const { hex, txid } = await signedTx();
    installFetch({
      '/api/tx': () => {
        throw new TypeError('Failed to fetch');
      },
    });

    const error = await new TransactionService(true).broadcastTransaction(hex).catch((e) => e);

    expect(error).toBeInstanceOf(BtcBroadcastUnknownError);
    expect(error.name).toBe('BtcBroadcastUnknownError');
    expect(error.txid).toBe(txid);
    expect(error.signedTxHex).toBe(hex);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test('throws BtcBroadcastUnknownError on a 5xx', async () => {
    const { hex, txid } = await signedTx();
    installFetch({ '/api/tx': () => textResponse('upstream timeout', 504) });

    await expect(new TransactionService(true).broadcastTransaction(hex)).rejects.toMatchObject({
      name: 'BtcBroadcastUnknownError',
      txid,
    });
  });

  test('throws BtcBroadcastUnknownError when the body cannot be read', async () => {
    const { hex } = await signedTx();
    const unreadable = textResponse('ok');
    jest.spyOn(unreadable, 'text').mockRejectedValue(new Error('connection reset'));
    installFetch({ '/api/tx': () => unreadable });

    await expect(new TransactionService(true).broadcastTransaction(hex)).rejects.toBeInstanceOf(
      BtcBroadcastUnknownError,
    );
  });

  test('returns success: false when the node refuses the transaction', async () => {
    const { hex } = await signedTx();
    installFetch({ '/api/tx': () => textResponse(rpcError(-25), 400) });

    const result = await new TransactionService(true).broadcastTransaction(hex);

    expect(result.success).toBe(false);
    expect(result.result).toBeNull();
    expect(result.error).toMatch(/-25/);
  });

  test('treats a transaction the network already has as accepted', async () => {
    const { hex, txid } = await signedTx();
    installFetch({ '/api/tx': () => textResponse(rpcError(-27), 400) });

    const result = await new TransactionService(true).broadcastTransaction(hex);

    expect(result).toEqual({ success: true, result: txid, error: null });
  });

  test('rejects hex that is not a transaction without sending it', async () => {
    const { calls } = installFetch({});

    const result = await new TransactionService(true).broadcastTransaction('not-hex');

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('sendBtc', () => {
  test('throws BtcBroadcastUnknownError when the broadcast outcome is unknown', async () => {
    const { calls } = installFetch({
      ...UTXO_HANDLERS,
      '/api/tx': () => {
        throw new Error('network timeout');
      },
    });

    const error = await new BtcClient('testnet').sendBtc(SENDER_WIF, RECIPIENT, 0.0005, 10).catch((e) => e);

    expect(error).toBeInstanceOf(BtcBroadcastUnknownError);
    const broadcast = calls.find((c) => c.method === 'POST');
    expect(error.signedTxHex).toBe(broadcast?.rawBody);
    expect(error.txid).toBe(bitcoin.Transaction.fromHex(error.signedTxHex).getId());
  });

  test('returns null when the network refuses the transaction', async () => {
    installFetch({ ...UTXO_HANDLERS, '/api/tx': () => textResponse(rpcError(-26), 400) });

    expect(await new BtcClient('testnet').sendBtc(SENDER_WIF, RECIPIENT, 0.0005, 10)).toBeNull();
  });

  test('returns null without broadcasting when the transaction cannot be built', async () => {
    const { calls } = installFetch(UTXO_HANDLERS);

    expect(await new BtcClient('testnet').sendBtc(SENDER_WIF, RECIPIENT, 5, 10)).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('checkBroadcast', () => {
  const NOT_FOUND = () => textResponse('No such mempool or blockchain transaction', 404);

  test('found when the transaction status lookup succeeds', async () => {
    const { hex, txid } = await signedTx();
    installFetch({ [`/tx/${txid}/status`]: () => ({ confirmed: false }) });

    expect(await new BtcClient('testnet').checkBroadcast(hex)).toEqual({ state: 'found', txid, confirmed: false });
  });

  test('absent when the transaction is unknown and its inputs are unspent', async () => {
    const { hex, txid } = await signedTx();
    const { calls } = installFetch({
      [`/tx/${txid}/status`]: NOT_FOUND,
      [`/tx/${PREV_TXID}/outspends`]: () => [{ spent: true, txid: OTHER_TXID }, { spent: false }],
    });

    expect(await new BtcClient('testnet').checkBroadcast(hex)).toEqual({ state: 'absent', txid });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  test('conflicted when an input is spent by another transaction', async () => {
    const { hex, txid } = await signedTx();
    installFetch({
      [`/tx/${txid}/status`]: NOT_FOUND,
      [`/tx/${PREV_TXID}/outspends`]: () => [{ spent: false }, { spent: true, txid: OTHER_TXID }],
    });

    expect(await new BtcClient('testnet').checkBroadcast(hex)).toEqual({
      state: 'conflicted',
      txid,
      conflictingTxid: OTHER_TXID,
    });
  });

  test('found when an input is spent by this transaction although the status lookup missed it', async () => {
    const { hex, txid } = await signedTx();
    installFetch({
      [`/tx/${txid}/status`]: NOT_FOUND,
      [`/tx/${PREV_TXID}/outspends`]: () => [{ spent: false }, { spent: true, txid, status: { confirmed: true } }],
    });

    expect(await new BtcClient('testnet').checkBroadcast(hex)).toEqual({ state: 'found', txid, confirmed: true });
  });

  test('unresolved when an input is spent but the spender is not reported', async () => {
    const { hex, txid } = await signedTx();
    installFetch({
      [`/tx/${txid}/status`]: NOT_FOUND,
      [`/tx/${PREV_TXID}/outspends`]: () => [{ spent: false }, { spent: true, status: { confirmed: true } }],
    });

    expect(await new BtcClient('testnet').checkBroadcast(hex)).toEqual({ state: 'unresolved', txid });
  });

  test('throws when the status lookup fails', async () => {
    const { hex, txid } = await signedTx();
    installFetch({ [`/tx/${txid}/status`]: () => jsonResponse({ error: 'Failed' }, 500) });

    await expect(new BtcClient('testnet').checkBroadcast(hex)).rejects.toThrow(/HTTP 500/);
  });

  test('throws when an outspends lookup fails', async () => {
    const { hex, txid } = await signedTx();
    installFetch({
      [`/tx/${txid}/status`]: NOT_FOUND,
      [`/tx/${PREV_TXID}/outspends`]: () => jsonResponse({ error: 'Failed' }, 500),
    });

    await expect(new BtcClient('testnet').checkBroadcast(hex)).rejects.toThrow(/outspends/);
  });
});

test('BtcBroadcastUnknownError is exported from the package root and the btc namespace', () => {
  expect(sdk.BtcBroadcastUnknownError).toBe(BtcBroadcastUnknownError);
  expect(sdk.btc.BtcBroadcastUnknownError).toBe(BtcBroadcastUnknownError);
});
