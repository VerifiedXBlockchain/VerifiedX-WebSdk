/**
 * Multi-vault vBTC withdrawals (Core 9.0): one Type 27 opens a share per
 * vault; each share is followed, raised, released or cancelled on its own.
 */
import {
  PreSignCheckError,
  TransactionRefusedError,
  VBTC_MULTI_WITHDRAWAL_FUNCTION,
  VfxClient,
  assertBtcAddressOnNetwork,
  vbtcMultiWithdrawalData,
  withdrawalFeeFloorError,
} from '../index';
import { Network, TxType } from '../constants';
import KeypairService from '../services/keypair-service';
import { shareOutcome } from '../services/vbtc-multi-withdrawal';
import { CapturedCall, FetchHandler, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const address = keypairService.addressFromPrivate(privateKey);
const BTC = 'tb1qqurswpc8qurswpc8qurswpc8qurswpc800zzll';
const PREPARE = '/btc/vbtc-v2/withdraw/complete/prepare/';

describe('withdrawalFeeFloorError', () => {
  test("matches Core's watched-vault rule: fee of a 154 vB transaction plus a 546 sat payout", () => {
    // 3 sat/vB: 462 sats of fee + 546 dust = 1008 sats minimum.
    expect(withdrawalFeeFloorError(0.00001008, 3, 'x')).toBeNull();
    expect(withdrawalFeeFloorError(0.00001007, 3, 'x')).toMatch(/minimum at this fee rate is 0.00001008 BTC/);
    // A payout between Core's builder floor (330) and 546 passes the builder but a watched vault refuses it at send.
    expect(withdrawalFeeFloorError(0.00000792, 3, 'x')).toMatch(/payout must be at least 546 sats/);
    expect(withdrawalFeeFloorError(0.000004, 3, 'share')).toMatch(/^share: 0.000004 BTC cannot pay/);
  });
});

describe('assertBtcAddressOnNetwork', () => {
  test('accepts a signet/testnet address on testnet and refuses mainnet or junk', () => {
    expect(() => assertBtcAddressOnNetwork(BTC, Network.Testnet, 'l')).not.toThrow();
    expect(() => assertBtcAddressOnNetwork('bc1qqurswpc8qurswpc8qurswpc8qurswpc89fe3yv', Network.Testnet, 'l')).toThrow(
      /not a Bitcoin address on testnet/,
    );
    expect(() => assertBtcAddressOnNetwork('tb1qnotarealaddress000', Network.Testnet, 'l')).toThrow();
    expect(() => assertBtcAddressOnNetwork(BTC, Network.Mainnet, 'l')).toThrow(/on mainnet/);
  });
});

describe('vbtcMultiWithdrawalData', () => {
  const base = { requestorAddress: 'xA', btcAddress: BTC, feeRate: 2 };

  test("emits Core's BuildMultiWithdrawalTxData shape: no ContractUID, no Amount", () => {
    const data = vbtcMultiWithdrawalData({
      ...base,
      totalAmount: 0.00006,
      inputs: [
        { scIdentifier: 'wiz', amount: 0.00003 },
        { scIdentifier: 'm2', amount: 0.00003 },
      ],
    });
    expect(Object.keys(data)).toEqual([
      'Function',
      'RequestorAddress',
      'BTCAddress',
      'TotalAmount',
      'FeeRate',
      'Inputs',
    ]);
    expect(data.Function).toBe(VBTC_MULTI_WITHDRAWAL_FUNCTION);
    expect(data.TotalAmount).toBe(0.00006);
    expect(data.Inputs).toEqual([
      { SCUID: 'wiz', Amount: 0.00003 },
      { SCUID: 'm2', Amount: 0.00003 },
    ]);
  });

  test('refuses what the validator refuses', () => {
    const two = [
      { scIdentifier: 'a', amount: 0.0001 },
      { scIdentifier: 'b', amount: 0.0001 },
    ];
    expect(() => vbtcMultiWithdrawalData({ ...base, totalAmount: 0.0003, inputs: two })).toThrow(/must equal the sum/);
    expect(() => vbtcMultiWithdrawalData({ ...base, totalAmount: 0.0002, inputs: [two[0], { ...two[0] }] })).toThrow(
      /distinct vaults/,
    );
    expect(() => vbtcMultiWithdrawalData({ ...base, totalAmount: 0.0001, inputs: [two[0]] })).toThrow(/at least two/);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ scIdentifier: `v${i}`, amount: 0.0001 }));
    expect(() => vbtcMultiWithdrawalData({ ...base, totalAmount: 0.0011, inputs: eleven })).toThrow(/at most 10/);
    expect(() =>
      vbtcMultiWithdrawalData({
        ...base,
        feeRate: 3,
        totalAmount: 0.000039,
        inputs: [
          { scIdentifier: 'a', amount: 0.000035 },
          { scIdentifier: 'b', amount: 0.000004 },
        ],
      }),
    ).toThrow(/vault b: 0.000004 BTC cannot pay/);
    expect(() => vbtcMultiWithdrawalData({ ...base, feeRate: 2.5, totalAmount: 0.0002, inputs: two })).toThrow(
      /whole number/,
    );
  });
});

describe('shareOutcome', () => {
  const w = (o: Record<string, unknown>) =>
    ({ paid: false, closed: false, notMinedYet: false, state: 'Pinned', ...o } as never);
  test('maps the node state to one outcome', () => {
    expect(shareOutcome(null)).toBe('legacy');
    expect(shareOutcome(w({ paid: true, closed: true, state: 'Settled' }))).toBe('paid');
    expect(shareOutcome(w({ closed: true, state: 'Released' }))).toBe('released');
    expect(shareOutcome(w({ closed: true, state: 'Cancelled' }))).toBe('cancelled');
    expect(shareOutcome(w({ closed: true, state: 'Expired' }))).toBe('closed');
    expect(shareOutcome(w({ notMinedYet: true, state: null }))).toBe('not_mined');
    expect(shareOutcome(w({ state: 'Waiting' }))).toBe('waiting');
    expect(shareOutcome(w({}))).toBe('being_paid');
  });
});

describe('VfxClient.requestWithdrawalMulti', () => {
  let client: VfxClient;

  const tokens = [
    { sc_identifier: 'web1', addresses: { [address]: 0.00002 }, available_balances: { [address]: 0.00002 } },
    { sc_identifier: 'm1', addresses: { [address]: 0.000035 }, available_balances: { [address]: 0.000015 } },
    { sc_identifier: 'legacy', addresses: { [address]: 0.0001 }, available_balances: { [address]: 0.0001 } },
  ];

  function installPipeline(overrides: Record<string, FetchHandler> = {}): { calls: CapturedCall[] } {
    return installFetch({
      [`/btc/vbtc-v2/${address}/`]: () => ({ results: tokens }),
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('2'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00001375 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'WR_MULTI' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
      '/raw/send/': () => ({ Result: 'Success' }),
      ...overrides,
    });
  }

  beforeEach(() => {
    client = new VfxClient('testnet');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('allocates across the allowed vaults and sends one signed Type 27 through /raw', async () => {
    const { calls } = installPipeline();
    const result = await client.requestWithdrawalMulti({
      btcAddress: BTC,
      totalAmount: 0.000035,
      feeRate: 3,
      privateKey,
      vaults: ['web1', 'm1'],
    });

    expect(result).toEqual({
      withdrawalRequestHash: 'WR_MULTI',
      inputs: [
        { scIdentifier: 'web1', amount: 0.00002 },
        { scIdentifier: 'm1', amount: 0.000015 },
      ],
      totalAmount: 0.000035,
      btcAddress: BTC,
      feeRate: 3,
      fee: 0.00001375,
    });
    const send = calls.find((c) => c.url.includes('/raw/send/'));
    const tx = (send?.body as { transaction: Record<string, unknown> }).transaction;
    expect(tx.TransactionType).toBe(TxType.VbtcV2WithdrawalRequest);
    expect(tx.FromAddress).toBe(address);
    expect(tx.ToAddress).toBe(address);
    expect(tx.Amount).toBe(0);
    expect(tx.Signature).toBeTruthy();
    const data = typeof tx.Data === 'string' ? JSON.parse(tx.Data as string) : tx.Data;
    expect(data.Function).toBe(VBTC_MULTI_WITHDRAWAL_FUNCTION);
    expect(data.RequestorAddress).toBe(address);
    expect(data.Inputs).toEqual([
      { SCUID: 'web1', Amount: 0.00002 },
      { SCUID: 'm1', Amount: 0.000015 },
    ]);
    expect(calls.some((c) => c.url.includes('/withdraw/request/'))).toBe(false);
  });

  test('takes explicit inputs without reading balances', async () => {
    const { calls } = installPipeline();
    const inputs = [
      { scIdentifier: 'wiz', amount: 0.00003 },
      { scIdentifier: 'm2', amount: 0.00003 },
    ];
    const result = await client.requestWithdrawalMulti({
      btcAddress: BTC,
      totalAmount: 0.00006,
      feeRate: 2,
      privateKey,
      inputs,
    });
    expect(result.inputs).toEqual(inputs);
    expect(calls.some((c) => c.url.includes(`/btc/vbtc-v2/${address}/`))).toBe(false);
  });

  test('one vault covers it: the single-vault request through Spyglass', async () => {
    const { calls } = installPipeline({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'WR_SINGLE', Fee: 0.00001 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_SINGLE' }),
    });
    const result = await client.requestWithdrawalMulti({
      btcAddress: BTC,
      totalAmount: 0.00005,
      feeRate: 1,
      privateKey,
    });
    expect(result.withdrawalRequestHash).toBe('WR_SINGLE');
    expect(result.inputs).toEqual([{ scIdentifier: 'legacy', amount: 0.00005 }]);
    const prepare = calls.find((c) => c.url.includes('/withdraw/request/prepare/'));
    expect(prepare?.body).toMatchObject({
      sc_identifier: 'legacy',
      requestor_address: address,
      amount: 0.00005,
      fee_rate: 1,
    });
    expect(calls.some((c) => c.url.includes('/raw/'))).toBe(false);
  });

  test('refuses to sign a fee above maxFee; nothing is signed or sent', async () => {
    const { calls } = installPipeline({ '/raw/fee/': () => ({ Result: 'Success', Fee: 5 }) });
    await expect(
      client.requestWithdrawalMulti({
        btcAddress: BTC,
        totalAmount: 0.000035,
        feeRate: 1,
        privateKey,
        vaults: ['web1', 'm1'],
      }),
    ).rejects.toThrow(PreSignCheckError);
    expect(calls.some((c) => c.url.includes('/raw/validate-signature/') || c.url.includes('/raw/send/'))).toBe(false);
  });

  test("surfaces the node's refusal at verify with its reason", async () => {
    installPipeline({
      '/raw/verify/': () => ({
        Result: 'Fail',
        Message: 'A withdrawal request for contract m1 is already pending in the mempool.',
      }),
    });
    const attempt = client.requestWithdrawalMulti({
      btcAddress: BTC,
      totalAmount: 0.000035,
      feeRate: 1,
      privateKey,
      vaults: ['web1', 'm1'],
    });
    await expect(attempt).rejects.toThrow(TransactionRefusedError);
  });

  test('refuses before any request: wrong-network address, short balance, dust share, too many vaults', async () => {
    const { calls } = installPipeline();
    await expect(
      client.requestWithdrawalMulti({
        btcAddress: 'bc1qqurswpc8qurswpc8qurswpc8qurswpc89fe3yv',
        totalAmount: 0.00001,
        feeRate: 1,
        privateKey,
      }),
    ).rejects.toThrow(/not a Bitcoin address on testnet/);
    expect(calls).toHaveLength(0);

    await expect(
      client.requestWithdrawalMulti({
        btcAddress: BTC,
        totalAmount: 0.0002,
        feeRate: 1,
        privateKey,
        vaults: ['web1', 'm1'],
      }),
    ).rejects.toThrow(/insufficient vBTC: 0.000035 available across 2 vaults/);

    // 0.000035 over web1 + m1 at 50 sat/vB: each share must be at least 0.00008246.
    await expect(
      client.requestWithdrawalMulti({
        btcAddress: BTC,
        totalAmount: 0.000035,
        feeRate: 50,
        privateKey,
        vaults: ['web1', 'm1'],
      }),
    ).rejects.toThrow(/cannot pay a Bitcoin withdrawal at 50 sat\/vB/);
    expect(calls.some((c) => c.url.includes('/raw/'))).toBe(false);

    await expect(
      client.requestWithdrawalMulti({ btcAddress: BTC, totalAmount: 1, feeRate: 2.5, privateKey }),
    ).rejects.toThrow(/whole number/);
  });

  test('refuses a reserve account and dry-run clients', async () => {
    await expect(
      new VfxClient('testnet', true).requestWithdrawalMulti({
        btcAddress: BTC,
        totalAmount: 1,
        feeRate: 1,
        privateKey,
      }),
    ).rejects.toThrow();
  });
});

describe('VfxClient share following', () => {
  let client: VfxClient;

  const answer = (sc: string, body: Record<string, unknown>): Response =>
    jsonResponse({
      success: true,
      Attested: true,
      SmartContractUID: sc,
      WithdrawalRequestHash: 'WR_MULTI',
      NotMinedYet: false,
      ...body,
    });

  const pinned = (sc: string, txid: string): Response =>
    answer(sc, {
      Paid: false,
      Status: 'Awaiting_BTC_Confirmation',
      PinnedBTCTransactionHash: txid,
      Withdrawal: { State: 'Pinned', FeeRate: 1, CanRaiseFee: true, CanRelease: true, Transactions: [] },
    });

  const paid = (sc: string, txid: string): Response =>
    answer(sc, {
      Paid: true,
      Status: 'Completed',
      BTCTransactionHash: txid,
      Withdrawal: { State: 'Settled', FeeRate: 3, Transactions: [] },
    });

  const releasedClosed = (): Response =>
    jsonResponse(
      {
        success: false,
        raw: {
          Success: false,
          Attested: true,
          Paid: false,
          Status: 'Closed',
          Withdrawal: { State: 'Released', FeeRate: 2, Transactions: [] },
        },
      },
      500,
    );

  const shares = [
    { scIdentifier: 'm2', amount: 0.00005 },
    { scIdentifier: 'm1', amount: 0.00002 },
  ];

  function routeByVault(handlers: Record<string, Array<() => Response>>): { calls: CapturedCall[] } {
    return installFetch({
      [PREPARE]: (_url, init) => {
        const sc = JSON.parse(init?.body as string).sc_identifier as string;
        const queue = handlers[sc];
        return (queue.length > 1 ? queue.shift() : queue[0])!();
      },
    });
  }

  beforeEach(() => {
    client = new VfxClient('testnet');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('getWithdrawalShares reads each share from the node by vault and request hash', async () => {
    const { calls } = routeByVault({ m2: [() => pinned('m2', 'PIN_M2')], m1: [() => paid('m1', 'PAID_M1')] });
    const result = await client.getWithdrawalShares({
      withdrawalRequestHash: 'WR_MULTI',
      requestorAddress: address,
      shares,
    });

    expect(result.map((s) => [s.scIdentifier, s.outcome, s.pinnedBtcTransactionHash, s.btcTransactionHash])).toEqual([
      ['m2', 'being_paid', 'PIN_M2', null],
      ['m1', 'paid', null, 'PAID_M1'],
    ]);
    expect(result[0].watched?.canRaiseFee).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([
      { sc_identifier: 'm2', withdrawal_request_hash: 'WR_MULTI', owner_address: address },
      { sc_identifier: 'm1', withdrawal_request_hash: 'WR_MULTI', owner_address: address },
    ]);
  });

  test('a vault the chain does not watch reads as legacy (FROST completion)', async () => {
    installFetch({ [PREPARE]: () => ({ success: true, SessionId: 's', StartMessage: 'm', Amount: 0.00002 }) });
    const [share] = await client.getWithdrawalShares({
      withdrawalRequestHash: 'WR',
      requestorAddress: address,
      shares: [{ scIdentifier: 'old', amount: 0.00002 }],
    });
    expect(share.outcome).toBe('legacy');
    expect(share.watched).toBeNull();
  });

  test('followWithdrawalShares polls until every share is final, riding out an unreachable node', async () => {
    const unreachable = (): Response => jsonResponse({ success: false, raw: { Unreachable: true } }, 500);
    routeByVault({
      m2: [() => pinned('m2', 'PIN_M2'), unreachable, () => paid('m2', 'PAY_M2')],
      m1: [() => pinned('m1', 'PIN_M1'), () => releasedClosed(), () => releasedClosed()],
    });
    const seen: string[][] = [];
    const result = await client.followWithdrawalShares({
      withdrawalRequestHash: 'WR_MULTI',
      requestorAddress: address,
      shares,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      onProgress: (s) => seen.push(s.map((x) => x.outcome)),
    });

    expect(result.settled).toBe(true);
    expect(result.shares.map((s) => s.outcome)).toEqual(['paid', 'released']);
    expect(seen[0]).toEqual(['being_paid', 'being_paid']);
  });

  test('followWithdrawalShares returns the shares as they stand at the deadline', async () => {
    routeByVault({ m2: [() => pinned('m2', 'PIN_M2')], m1: [() => pinned('m1', 'PIN_M1')] });
    const result = await client.followWithdrawalShares({
      withdrawalRequestHash: 'WR_MULTI',
      requestorAddress: address,
      shares,
      pollIntervalMs: 5,
      timeoutMs: 20,
    });
    expect(result.settled).toBe(false);
    expect(result.shares.map((s) => s.outcome)).toEqual(['being_paid', 'being_paid']);
  });

  test('per-share fee raise and release reuse the Type 44 builders with the share vault', async () => {
    const { calls } = installFetch({
      [PREPARE]: () => pinned('m2', 'PIN_M2'),
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('3'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00001 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'BUMP' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
      '/raw/send/': () => ({ Result: 'Success' }),
    });
    await client.bumpWithdrawalFee({ scIdentifier: 'm2', withdrawalRequestHash: 'WR_MULTI', feeRate: 3, privateKey });
    await client.releaseWithdrawal({ scIdentifier: 'm1', withdrawalRequestHash: 'WR_MULTI', feeRate: 2, privateKey });
    const sends = calls
      .filter((c) => c.url.includes('/raw/send/'))
      .map((c) => (c.body as { transaction: Record<string, unknown> }).transaction);
    const data = sends.map((tx) => (typeof tx.Data === 'string' ? JSON.parse(tx.Data as string) : tx.Data));
    expect(sends.map((tx) => tx.TransactionType)).toEqual([TxType.VbtcV2CoinPin, TxType.VbtcV2CoinPin]);
    expect(data).toEqual([
      { Function: 'VBTCWithdrawalFeeBump()', ContractUID: 'm2', WithdrawalRequestHash: 'WR_MULTI', FeeRate: 3 },
      { Function: 'VBTCWithdrawalRelease()', ContractUID: 'm1', WithdrawalRequestHash: 'WR_MULTI', FeeRate: 2 },
    ]);
  });
});
