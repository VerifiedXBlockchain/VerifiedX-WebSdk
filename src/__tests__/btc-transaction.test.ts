import * as bitcoin from 'bitcoinjs-lib';
import TransactionService from '../btc/transaction';

// Testnet WIF already used by the signing vectors in btc.test.ts.
const SENDER_WIF = 'cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M';
const RECIPIENT = 'tb1qr0eyx8j8w8u7n4vtvu6ywyk3smkhhexw42zrvm';
const FAKE_TXID = 'aa'.repeat(32);

function installUtxoFetch(utxoValues: number[]): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/utxo')) {
      return new Response(
        JSON.stringify(utxoValues.map((value, i) => ({ txid: FAKE_TXID, vout: i, value, status: { confirmed: true } }))),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/fees/recommended')) {
      return new Response(
        JSON.stringify({ fastestFee: 30, halfHourFee: 20, hourFee: 10, economyFee: 7, minimumFee: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`No mock for URL: ${url}`);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

afterEach(() => {
  jest.resetAllMocks();
});

// One P2WPKH input (68 vB) + recipient output (31 vB) + overhead (10 vB):
//   with change:    140 vB -> fee = 1400 sats at 10 sat/vB
//   without change: 109 vB -> fee = 1090 sats at 10 sat/vB
const FEE_RATE = 10;
const service = new TransactionService(true);

describe('createTransaction', () => {
  test('adds a change output when change is above dust', async () => {
    installUtxoFetch([100_000]);
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, FEE_RATE);

    expect(result.success).toBe(true);
    const tx = bitcoin.Transaction.fromHex(result.result as string);
    expect(tx.outs).toHaveLength(2);
    expect(tx.outs[0].value).toBe(50_000);
    expect(tx.outs[1].value).toBe(100_000 - 50_000 - 1_400);
  });

  test('folds sub-dust change into the fee instead of creating a dust output', async () => {
    installUtxoFetch([51_600]); // change would be 200 sats
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, FEE_RATE);

    expect(result.success).toBe(true);
    const tx = bitcoin.Transaction.fromHex(result.result as string);
    expect(tx.outs).toHaveLength(1);
    expect(tx.outs[0].value).toBe(50_000);
  });

  test('fails with a clear error when funds are insufficient', async () => {
    installUtxoFetch([50_500]); // 50_000 + 1_090 fee > 50_500
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, FEE_RATE);

    expect(result.success).toBe(false);
    expect(result.result).toBeNull();
    expect(result.error).toMatch(/Insufficient funds/);
    expect(result.error).toMatch(/50500/);
  });

  test('honors the caller-provided feeRate on testnet (no forced override)', async () => {
    installUtxoFetch([100_000]);
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, 20);

    expect(result.success).toBe(true);
    const tx = bitcoin.Transaction.fromHex(result.result as string);
    // fee = 140 vB * 20 sat/vB = 2800, so change = 47200 (would be 48600 at the old forced 5 -> 700 fee)
    expect(tx.outs[1].value).toBe(100_000 - 50_000 - 2_800);
  });

  test('falls back to the economy fee rate when none is provided', async () => {
    const mock = installUtxoFetch([100_000]);
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, 0);

    expect(result.success).toBe(true);
    expect(mock.mock.calls.some(([input]) => String(input).includes('/fees/recommended'))).toBe(true);
    const tx = bitcoin.Transaction.fromHex(result.result as string);
    expect(tx.outs[1].value).toBe(100_000 - 50_000 - 140 * 7); // economyFee = 7
  });

  test('rejects a non-positive amount before any network call', async () => {
    const mock = installUtxoFetch([100_000]);
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0, FEE_RATE);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid amount/);
    expect(mock).not.toHaveBeenCalled();
  });

  test('fails cleanly when the address has no UTXOs', async () => {
    installUtxoFetch([]);
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, FEE_RATE);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No UTXOs/);
  });

  test('spends multiple UTXOs and sizes the fee accordingly', async () => {
    installUtxoFetch([30_000, 30_000, 30_000]);
    const result = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, FEE_RATE);

    expect(result.success).toBe(true);
    const tx = bitcoin.Transaction.fromHex(result.result as string);
    expect(tx.ins).toHaveLength(3);
    // 3 inputs: (3*68 + 2*31 + 10) * 10 = 2760 fee
    expect(tx.outs[1].value).toBe(90_000 - 50_000 - 2_760);
  });
});
