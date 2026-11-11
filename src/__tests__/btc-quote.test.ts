import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import BtcClient, * as btc from '../btc';
import * as browserBtc from '../browser/btc';
import { BtcSpendType, addressForSpendType } from '../btc/address-types';
import { btcSignerFromWif } from '../btc/signer';
import { planBtcPayment } from '../btc/payment-plan';

// The quote (wallet review 2026-11-10, M3) must be what the send charges: the
// same UTXOs (all of them), sizes and arithmetic.

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const TESTNET = bitcoin.networks.testnet;
const WIF = 'cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M';
const keyPair = ECPair.fromWIF(WIF, TESTNET);
const P2WPKH_RECIPIENT = 'tb1qag9awtlf96mx998m9x76pue86akj6hgr0flf8c';
const P2TR_RECIPIENT = addressForSpendType(
  ECPair.fromPrivateKey(Buffer.alloc(32, 3), { network: TESTNET }).publicKey,
  'p2tr',
  TESTNET,
) as string;

/** Serve `values` as UTXOs of `address`, all outputs of one made-up previous transaction, like Esplora. */
function fund(address: string, values: number[], economyFee = 3): void {
  const prev = new bitcoin.Transaction();
  prev.addInput(Buffer.alloc(32, 9), 0);
  for (const value of values) prev.addOutput(bitcoin.address.toOutputScript(address, TESTNET), value);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`/address/${address}/utxo`)) {
      return new Response(JSON.stringify(values.map((value, vout) => ({ txid: prev.getId(), vout, value }))));
    }
    if (url.endsWith('/raw')) return new Response(prev.toBuffer());
    if (url.includes('/fees/recommended')) return new Response(JSON.stringify({ economyFee }));
    throw new Error(`No mock for ${url}`);
  }) as unknown as typeof fetch;
}

/** What a built transaction actually pays and returns. */
function charged(hex: string, inputTotal: number, address: string) {
  const tx = bitcoin.Transaction.fromHex(hex);
  const outputTotal = tx.outs.reduce((sum, out) => sum + out.value, 0);
  const changeScript = bitcoin.address.toOutputScript(address, TESTNET);
  const change = tx.outs.find((out) => out.script.equals(changeScript));
  return { feeSats: inputTotal - outputTotal, inputCount: tx.ins.length, changeSats: change?.value ?? 0 };
}

afterEach(() => jest.restoreAllMocks());

const client = new BtcClient('testnet');
const TYPES: BtcSpendType[] = ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh', 'p2tr', 'p2tr-bip86'];
const CASES = TYPES.flatMap((type) =>
  [1, 2, 10].flatMap((inputs) =>
    [P2WPKH_RECIPIENT, P2TR_RECIPIENT].map((recipient) => [type, inputs, recipient] as const),
  ),
);

describe('quoteTransaction agrees with the transaction that is built', () => {
  test.each(CASES)('%s, %i inputs, to %s', async (type, inputCount, recipient) => {
    const address = addressForSpendType(keyPair.publicKey, type, TESTNET) as string;
    const values = Array.from({ length: inputCount }, (_, i) => 20_000 + i * 1_111);
    const inputTotal = values.reduce((a, b) => a + b, 0);
    const amountSats = 12_345;
    const feeRate = 12;
    fund(address, values);

    const quote = await client.quoteTransaction(WIF, recipient, amountSats, feeRate, { addressType: type });
    const built = await client.createTransaction(WIF, recipient, amountSats / 1e8, feeRate, { addressType: type });
    expect(built.success).toBe(true);
    const actual = charged(built.result as string, inputTotal, address);

    expect(quote).toMatchObject({
      fromAddress: address,
      addressType: type,
      recipientAddress: recipient,
      amountSats,
      feeRate,
      inputCount,
      inputTotalSats: inputTotal,
      sufficient: true,
      hasChange: true,
      feeSats: actual.feeSats,
      changeSats: actual.changeSats,
      requiredSats: amountSats + actual.feeSats,
    });
    expect(actual.inputCount).toBe(inputCount);
    expect(quote.feeSats).toBe(Math.ceil(quote.vsize * feeRate));

    // The same quote from the address, and from a BtcSigner.
    const fromAddress = { ...quote, addressType: type === 'p2tr-bip86' ? 'p2tr' : type };
    expect(await client.quoteTransaction(address, recipient, amountSats, feeRate)).toEqual(fromAddress);
    expect(
      await client.quoteTransaction(btcSignerFromWif(WIF, 'testnet', type), recipient, amountSats, feeRate),
    ).toEqual(quote);
  });

  test.each(TYPES)('%s: the vsize counts every input', async (type) => {
    const address = addressForSpendType(keyPair.publicKey, type, TESTNET) as string;
    fund(address, [50_000]);
    const one = await client.quoteTransaction(address, P2WPKH_RECIPIENT, 10_000, 10, { addressType: type });
    fund(address, Array(10).fill(5_000));
    const ten = await client.quoteTransaction(address, P2WPKH_RECIPIENT, 10_000, 10, { addressType: type });
    const perInput = { p2wpkh: 68, 'p2sh-p2wpkh': 91, p2pkh: 148, p2tr: 58, 'p2tr-bip86': 58 }[type];
    expect(ten.vsize - one.vsize).toBe(9 * perInput);
  });
});

describe('quoteTransaction edge cases', () => {
  const address = addressForSpendType(keyPair.publicKey, 'p2wpkh', TESTNET) as string;

  test('sub-dust change goes to the fee, as the send does', async () => {
    // One P2WPKH input to a P2WPKH recipient at 10 sat/vB: 140 vB with change, 109 without.
    fund(address, [51_600]);
    const quote = await client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 50_000, 10);
    expect(quote).toMatchObject({ hasChange: false, changeSats: 0, feeSats: 1_600, vsize: 109, sufficient: true });
    const built = await client.createTransaction(WIF, P2WPKH_RECIPIENT, 0.0005, 10);
    expect(charged(built.result as string, 51_600, address).feeSats).toBe(1_600);
  });

  test('an amount the balance does not cover says so, with the least fee and what it needs', async () => {
    fund(address, [30_000, 30_000, 30_000]);
    const quote = await client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 89_000, 10);
    // 3 inputs, no change: (3*68 + 31 + 10) * 10 = 2450.
    expect(quote).toMatchObject({ sufficient: false, feeSats: 2_450, requiredSats: 91_450, inputCount: 3 });
    const built = await client.createTransaction(WIF, P2WPKH_RECIPIENT, 0.00089, 10);
    expect(built.success).toBe(false);
    expect(built.error).toMatch(/need 91450 sats/);
  });

  test('ten inputs cost ten inputs, not one', async () => {
    fund(address, Array(10).fill(10_000));
    const quote = await client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 20_000, 12);
    // (10*68 + 31 + 31 + 10) * 12 = 9024; one input would be (68 + 72) * 12 = 1680.
    expect(quote.feeSats).toBe(9_024);
    expect(quote.vsize).toBe(752);
  });

  test('no UTXOs is not sufficient', async () => {
    fund(address, []);
    expect(await client.quoteTransaction(address, P2WPKH_RECIPIENT, 1_000, 5)).toMatchObject({
      sufficient: false,
      inputCount: 0,
      inputTotalSats: 0,
    });
  });

  test('fee rate 0 uses the economy rate the send would use', async () => {
    fund(address, [100_000], 7);
    const quote = await client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 50_000, 0);
    expect(quote.feeRate).toBe(7);
    expect(quote.feeSats).toBe(140 * 7);
  });

  test('reads only the UTXOs and fee rates: nothing is broadcast', async () => {
    fund(address, [100_000]);
    await client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 50_000, 0);
    const urls = (global.fetch as jest.Mock).mock.calls.map(([input, init]) => [String(input), init?.method ?? 'GET']);
    expect(urls.every(([, method]) => method === 'GET')).toBe(true);
    expect(urls.some(([url]) => url.endsWith('/tx'))).toBe(false);
  });

  test('refuses an amount that is not a positive whole number of satoshis', async () => {
    fund(address, [100_000]);
    await expect(client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 0.5, 5)).rejects.toThrow(/whole number/);
    await expect(client.quoteTransaction(WIF, P2WPKH_RECIPIENT, 0, 5)).rejects.toThrow(/whole number/);
  });

  test('refuses a recipient that is not an address, or is for another network', async () => {
    fund(address, [100_000]);
    await expect(client.quoteTransaction(WIF, 'not-an-address', 1_000, 5)).rejects.toThrow();
    // A mainnet address, quoted on testnet.
    await expect(
      client.quoteTransaction(WIF, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 1_000, 5),
    ).rejects.toThrow();
  });

  test('refuses an addressType the address is not', async () => {
    fund(address, [100_000]);
    await expect(
      client.quoteTransaction(address, P2WPKH_RECIPIENT, 1_000, 5, { addressType: 'p2pkh' }),
    ).rejects.toThrow(/not a p2pkh address/);
  });
});

describe('planBtcPayment', () => {
  test('keeps the historical P2WPKH estimate', () => {
    // (3*68 + 2*31 + 10) * 10 = 2760, as the createTransaction tests pin.
    expect(
      planBtcPayment({
        spendType: 'p2wpkh',
        inputCount: 3,
        inputSum: 90_000,
        amountSats: 50_000,
        feeRate: 10,
        recipientScriptLength: 0,
      }),
    ).toEqual({ sufficient: true, hasChange: true, changeSats: 37_240, feeSats: 2_760, vsize: 276 });
  });
});

describe('quoteBtcPayment (coins in hand, no I/O) agrees with the transaction that is built', () => {
  const FEE_RATE = 7;
  const VALUES = [20_000, 31_111, 9_876];
  const INPUT_TOTAL = VALUES.reduce((a, b) => a + b, 0);
  const coins = (values: number[]) => values.map((value) => ({ value, status: { confirmed: true } }));

  async function build(type: BtcSpendType, recipient: string, amountSats: number) {
    const address = addressForSpendType(keyPair.publicKey, type, TESTNET) as string;
    fund(address, VALUES);
    const built = await client.createTransaction(WIF, recipient, amountSats / 1e8, FEE_RATE, { addressType: type });
    return { built, address };
  }

  const quote = (type: BtcSpendType, recipient: string | null, amountSats: number, values = VALUES) =>
    btc.quoteBtcPayment({
      utxos: coins(values),
      spendType: type,
      recipientAddress: recipient,
      amountSats,
      feeRate: FEE_RATE,
      network: 'testnet',
    });

  test.each(TYPES.flatMap((type) => [P2WPKH_RECIPIENT, P2TR_RECIPIENT].map((r) => [type, r] as const)))(
    '%s to %s: change, dust, Max and too much',
    async (type, recipient) => {
      // With change.
      const withChange = quote(type, recipient, 12_345);
      const a = await build(type, recipient, 12_345);
      expect(a.built.success).toBe(true);
      const actual = charged(a.built.result as string, INPUT_TOTAL, a.address);
      expect(withChange).toMatchObject({
        hasChange: true,
        sufficient: true,
        feeSats: actual.feeSats,
        changeSats: actual.changeSats,
        inputCount: 3,
      });
      expect(withChange.feeSats).toBe(Math.ceil(withChange.vsize * FEE_RATE));

      // Change below dust goes to the fee.
      const dustAmount = INPUT_TOTAL - withChange.feeSats - 100;
      const dust = quote(type, recipient, dustAmount);
      const b = await build(type, recipient, dustAmount);
      expect(dust).toMatchObject({
        hasChange: false,
        changeSats: 0,
        sufficient: true,
        feeSats: INPUT_TOTAL - dustAmount,
      });
      expect(charged(b.built.result as string, INPUT_TOTAL, b.address)).toMatchObject({
        feeSats: dust.feeSats,
        changeSats: 0,
      });

      // Max: amount plus the no-change fee is exactly the coins.
      const maxAmount = INPUT_TOTAL - Math.ceil(dust.vsize * FEE_RATE);
      const max = quote(type, recipient, maxAmount);
      const c = await build(type, recipient, maxAmount);
      expect(max).toMatchObject({ sufficient: true, hasChange: false, requiredSats: INPUT_TOTAL });
      expect(charged(c.built.result as string, INPUT_TOTAL, c.address).feeSats).toBe(max.feeSats);

      // One sat more is not covered, and the send refuses it.
      const over = quote(type, recipient, maxAmount + 1);
      const d = await build(type, recipient, maxAmount + 1);
      expect(over).toMatchObject({
        sufficient: false,
        hasChange: false,
        changeSats: 0,
        feeSats: max.feeSats,
        requiredSats: INPUT_TOTAL + 1,
      });
      expect(d.built.success).toBe(false);
      expect(d.built.error).toMatch(new RegExp(`need ${INPUT_TOTAL + 1} sats`));
    },
  );

  test.each(TYPES)('%s: the same quote quoteTransaction gives', async (type) => {
    const address = addressForSpendType(keyPair.publicKey, type, TESTNET) as string;
    fund(address, VALUES);
    const fetched = await client.quoteTransaction(address, P2TR_RECIPIENT, 12_345, FEE_RATE, { addressType: type });
    const { fromAddress, ...rest } = fetched;
    expect(fromAddress).toBe(address);
    expect(quote(type, P2TR_RECIPIENT, 12_345)).toEqual({ ...rest, unconfirmedInputs: 0 });
  });

  test.each(TYPES)('%s: no recipient yet is sized as a P2WPKH output', (type) => {
    expect(quote(type, null, 12_345)).toEqual({ ...quote(type, P2WPKH_RECIPIENT, 12_345), recipientAddress: null });
    const omitted = btc.quoteBtcPayment({
      utxos: coins(VALUES),
      spendType: type,
      amountSats: 12_345,
      feeRate: FEE_RATE,
      network: 'testnet',
    });
    expect(omitted).toEqual(quote(type, null, 12_345));
  });

  test('a zero amount quotes the fee of the coins, with the rest as change', () => {
    const zero = quote('p2wpkh', null, 0);
    // (3*68 + 31 + 31 + 10) * 7 = 1932.
    expect(zero).toMatchObject({
      amountSats: 0,
      feeSats: 1_932,
      vsize: 276,
      hasChange: true,
      changeSats: INPUT_TOTAL - 1_932,
      sufficient: true,
    });
  });

  test('no coins is never sufficient', () => {
    expect(quote('p2wpkh', null, 0, [])).toMatchObject({ inputCount: 0, inputTotalSats: 0, sufficient: false });
    expect(quote('p2tr', P2TR_RECIPIENT, 1_000, [])).toMatchObject({ inputCount: 0, sufficient: false });
  });

  test('counts the inputs not yet confirmed', () => {
    const utxos = [
      { value: 10_000, status: { confirmed: true } },
      { value: 10_000, status: { confirmed: false } },
      { value: 10_000 },
    ];
    expect(
      btc.quoteBtcPayment({ utxos, spendType: 'p2wpkh', amountSats: 1_000, feeRate: 2, network: 'testnet' })
        .unconfirmedInputs,
    ).toBe(2);
  });

  test('refuses what it cannot quote', () => {
    const base = {
      utxos: coins(VALUES),
      spendType: 'p2tr' as const,
      amountSats: 1_000,
      feeRate: 5,
      network: 'testnet' as const,
    };
    expect(() => btc.quoteBtcPayment({ ...base, amountSats: -1 })).toThrow(/whole number/);
    expect(() => btc.quoteBtcPayment({ ...base, amountSats: 0.5 })).toThrow(/whole number/);
    expect(() => btc.quoteBtcPayment({ ...base, feeRate: 0 })).toThrow(/above 0/);
    expect(() => btc.quoteBtcPayment({ ...base, recipientAddress: 'not-an-address' })).toThrow();
    expect(() =>
      btc.quoteBtcPayment({ ...base, recipientAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }),
    ).toThrow();
  });

  test('makes no request', () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    quote('p2pkh', P2TR_RECIPIENT, 12_345);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('is in the browser build, and takes its network placeholders', () => {
    expect(browserBtc.quoteBtcPayment).toBe(btc.quoteBtcPayment);
    const placeholder = browserBtc.quoteBtcPayment({
      utxos: coins(VALUES),
      spendType: 'p2wpkh',
      amountSats: 0,
      feeRate: FEE_RATE,
      network: browserBtc.networks.testnet,
    });
    expect(placeholder).toEqual(quote('p2wpkh', null, 0));
  });
});

describe('quoteTransaction with options.utxos', () => {
  const address = addressForSpendType(keyPair.publicKey, 'p2sh-p2wpkh', TESTNET) as string;
  const values = [40_000, 25_000];

  test('quotes those coins and fetches nothing', async () => {
    fund(address, values);
    const fetched = await client.quoteTransaction(address, P2TR_RECIPIENT, 30_000, 9);
    global.fetch = jest.fn() as unknown as typeof fetch;
    const given = await client.quoteTransaction(address, P2TR_RECIPIENT, 30_000, 9, {
      utxos: values.map((value) => ({ value, status: { confirmed: false } })),
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(given).toEqual(fetched);
  });

  test('still fetches the economy rate when the fee rate is 0', async () => {
    fund(address, values, 4);
    const quote = await client.quoteTransaction(address, P2TR_RECIPIENT, 30_000, 0, {
      utxos: values.map((value) => ({ value })),
    });
    const urls = (global.fetch as jest.Mock).mock.calls.map(([input]) => String(input));
    expect(quote.feeRate).toBe(4);
    expect(urls.some((url) => url.includes('/utxo'))).toBe(false);
  });

  test('keeps its checks: a zero amount or a bad recipient still throws', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(client.quoteTransaction(address, P2TR_RECIPIENT, 0, 5, { utxos: [] })).rejects.toThrow(
      /positive whole number/,
    );
    await expect(client.quoteTransaction(address, 'not-an-address', 1_000, 5, { utxos: [] })).rejects.toThrow();
  });
});
