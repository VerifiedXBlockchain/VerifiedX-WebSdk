import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { VBTC_MULTI_MAX_INPUTS, allocateVbtcInputs, vbtcMultiTransferData } from '../services/vbtc-multi';
import { Network, TxType } from '../constants';
import { CapturedCall, installFetch, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const address = keypairService.addressFromPrivate(privateKey);
const RECIPIENT = 'xRecipient00000000000000000000000';

describe('allocateVbtcInputs', () => {
  test('largest balance first, greedy, exact satoshis', () => {
    const allocation = allocateVbtcInputs({ a: 0.3, b: 1.0, c: 0.5 }, 1.2);
    expect(allocation.failure).toBeUndefined();
    expect(allocation.inputs).toEqual([
      { scIdentifier: 'b', amount: 1.0 },
      { scIdentifier: 'c', amount: 0.2 },
    ]);
    expect(allocation.available).toBe(1.8);
  });

  test('ties break by contract id and zero balances are skipped', () => {
    const allocation = allocateVbtcInputs({ z: 0.5, a: 0.5, m: 0, k: 0.5 }, 1.25);
    expect(allocation.inputs.map((i) => i.scIdentifier)).toEqual(['a', 'k', 'z']);
    expect(allocation.inputs[2].amount).toBe(0.25);
  });

  test('sums to the total without floating drift', () => {
    const allocation = allocateVbtcInputs({ a: 0.1, b: 0.2, c: 0.3 }, 0.6);
    const sumSats = allocation.inputs.reduce((s, i) => s + Math.round(i.amount * 1e8), 0);
    expect(sumSats).toBe(60_000_000);
  });

  test('reports insufficient balance and too many inputs', () => {
    expect(allocateVbtcInputs({ a: 0.1 }, 0.2).failure).toBe('insufficientBalance');
    const many: Record<string, number> = {};
    for (let i = 0; i < VBTC_MULTI_MAX_INPUTS + 1; i++) many[`c${String(i).padStart(2, '0')}`] = 0.01;
    const allocation = allocateVbtcInputs(many, 0.01 * (VBTC_MULTI_MAX_INPUTS + 1));
    expect(allocation.failure).toBe('tooManyInputs');
    expect(allocation.inputs).toEqual([]);
  });
});

describe('vbtcMultiTransferData', () => {
  test('emits exactly the five keys the node expects', () => {
    const data = vbtcMultiTransferData({
      fromAddress: 'xA',
      toAddress: 'xB',
      totalAmount: 0.3,
      inputs: [
        { scIdentifier: 's1', amount: 0.1 },
        { scIdentifier: 's2', amount: 0.2 },
      ],
    });
    expect(Object.keys(data)).toEqual(['Function', 'FromAddress', 'ToAddress', 'TotalAmount', 'Inputs']);
    expect(data.Function).toBe('TransferVBTCMultiV2()');
    expect(data.TotalAmount).toBe(0.3);
    expect(data.Inputs).toEqual([
      { SCUID: 's1', Amount: 0.1 },
      { SCUID: 's2', Amount: 0.2 },
    ]);
  });

  test('rejects what the node rejects: drift, duplicates, empty, too precise, too many', () => {
    const base = { fromAddress: 'xA', toAddress: 'xB' };
    expect(() =>
      vbtcMultiTransferData({ ...base, totalAmount: 0.31, inputs: [{ scIdentifier: 's1', amount: 0.3 }] }),
    ).toThrow(/must equal the sum/);
    expect(() =>
      vbtcMultiTransferData({
        ...base,
        totalAmount: 0.2,
        inputs: [
          { scIdentifier: 's1', amount: 0.1 },
          { scIdentifier: 's1', amount: 0.1 },
        ],
      }),
    ).toThrow(/distinct contracts/);
    expect(() => vbtcMultiTransferData({ ...base, totalAmount: 0, inputs: [] })).toThrow(/at least one input/);
    expect(() =>
      vbtcMultiTransferData({
        ...base,
        totalAmount: 0.000000001,
        inputs: [{ scIdentifier: 's1', amount: 0.000000001 }],
      }),
    ).toThrow(/8 decimal places/);
    const many = Array.from({ length: VBTC_MULTI_MAX_INPUTS + 1 }, (_, i) => ({ scIdentifier: `c${i}`, amount: 0.01 }));
    expect(() => vbtcMultiTransferData({ ...base, totalAmount: 0.26, inputs: many })).toThrow(/at most/);
  });
});

describe('VfxClient.transferVbtcMulti', () => {
  let client: VfxClient;

  function installPipeline(
    tokens: unknown[],
    overrides: Record<string, () => unknown> = {},
  ): { calls: CapturedCall[] } {
    return installFetch({
      [`/btc/vbtc-v2/${address}/`]: () => ({ results: tokens }),
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

  const tokens = [
    { sc_identifier: 'sc-small', addresses: { [address]: 0.3 }, available_balances: { [address]: 0.3 } },
    // available_balances wins over addresses: a pending withdrawal locks 0.5 of the 1.5.
    { sc_identifier: 'sc-big', addresses: { [address]: 1.5 }, available_balances: { [address]: 1.0 } },
    { sc_identifier: 'sc-legacy', addresses: { [address]: 0.2 } },
  ];

  beforeEach(() => {
    client = new VfxClient('testnet');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('reads spendable balances, allocates, and sends one Type 26 raw transaction', async () => {
    const { calls } = installPipeline(tokens);
    const result = await client.transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 1.4, privateKey });

    expect(result.transactionHash).toBe('TX_HASH_ABC');
    expect(result.inputs).toEqual([
      { scIdentifier: 'sc-big', amount: 1.0 },
      { scIdentifier: 'sc-small', amount: 0.3 },
      { scIdentifier: 'sc-legacy', amount: 0.1 },
    ]);

    const send = calls.find((c) => c.url.includes('/raw/send/'));
    const tx = (send?.body as { transaction: Record<string, unknown> }).transaction;
    expect(tx.TransactionType).toBe(TxType.VbtcV2Transfer);
    expect(tx.ToAddress).toBe(RECIPIENT);
    expect(tx.FromAddress).toBe(address);
    expect(tx.Amount).toBe(0);
    expect(tx.Data).toEqual({
      Function: 'TransferVBTCMultiV2()',
      FromAddress: address,
      ToAddress: RECIPIENT,
      TotalAmount: 1.4,
      Inputs: [
        { SCUID: 'sc-big', Amount: 1.0 },
        { SCUID: 'sc-small', Amount: 0.3 },
        { SCUID: 'sc-legacy', Amount: 0.1 },
      ],
    });
  });

  test('a transfer one contract can cover takes the ordinary transferVbtc path', async () => {
    const { calls } = installPipeline(tokens, {
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREP' }),
      '/btc/vbtc-v2/transfer/send/': () => ({ success: true, Hash: 'SENT' }),
    });
    const result = await client.transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 0.75, privateKey });
    expect(result).toEqual({ transactionHash: 'SENT', inputs: [{ scIdentifier: 'sc-big', amount: 0.75 }] });
    expect(calls.some((c) => c.url.includes('/raw/'))).toBe(false);
    expect((calls[1].body as Record<string, unknown>).sc_identifier).toBe('sc-big');
  });

  test('explicit inputs skip the balance lookup', async () => {
    const { calls } = installPipeline([]);
    const inputs = [
      { scIdentifier: 'x1', amount: 0.5 },
      { scIdentifier: 'x2', amount: 0.5 },
    ];
    const result = await client.transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 1, privateKey, inputs });
    expect(result.inputs).toBe(inputs);
    expect(calls.some((c) => c.url.includes('/btc/vbtc-v2/'))).toBe(false);
  });

  test('insufficient balance is reported before anything is built', async () => {
    const { calls } = installPipeline(tokens);
    await expect(client.transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 5, privateKey })).rejects.toThrow(
      /Insufficient vBTC: 1.5 available across 3 contracts/,
    );
    expect(calls.some((c) => c.url.includes('/raw/'))).toBe(false);
  });

  test('refuses dryRun and a non-positive amount before any request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      new VfxClient('testnet', true).transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 1, privateKey }),
    ).rejects.toThrow(/dryRun/);
    await expect(client.transferVbtcMulti({ toAddress: RECIPIENT, totalAmount: 0, privateKey })).rejects.toThrow(
      /positive totalAmount/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
