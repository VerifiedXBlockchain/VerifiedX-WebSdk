/**
 * Withdrawals from a vault the chain watches (Core 9.0 Bitcoin attestation).
 * The node answers the completion route with the withdrawal's state
 * (`BtcVaultView.CompletionAnswer`) instead of a FROST preparation, and
 * refuses a Type 28 completion, so the SDK polls for payment and offers fee
 * bump and release (Type 44) instead.
 */
import { VbtcWithdrawalClosedError, VbtcWithdrawalPendingError, VfxClient, parseWatchedWithdrawal } from '../index';
import { CapturedCall, FetchHandler, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const PREPARE = '/btc/vbtc-v2/withdraw/complete/prepare/';

function withdrawal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    State: 'Pinned',
    Summary: 'This withdrawal is paid by Bitcoin transaction PIN_TX, fixed by the chain.',
    FeeRate: 4,
    CanRaiseFee: true,
    CanRelease: true,
    Releasing: false,
    CanCancel: false,
    Transactions: [
      { Txid: 'PIN_TX', Kind: 'Payment', FeeRate: 4, FeeSats: 600, Superseded: false, Dead: false, Confirmed: false },
    ],
    ...overrides,
  };
}

/** A node answer Spyglass passed through with `Success: true` (spread into its body, HTTP 200). */
const pinned = (): Response =>
  jsonResponse({
    success: true,
    Paid: false,
    Attested: true,
    Message: '[AWAITING-BTC-CONFIRMATION] This withdrawal is paid by Bitcoin transaction PIN_TX.',
    Status: 'Awaiting_BTC_Confirmation',
    NothingToDo: true,
    NotMinedYet: false,
    VFXTransactionHash: null,
    BTCTransactionHash: null,
    PinnedBTCTransactionHash: 'PIN_TX',
    SmartContractUID: 'sc-1',
    WithdrawalRequestHash: 'WR_HASH',
    Withdrawal: withdrawal(),
  });

const paid = (): Response =>
  jsonResponse({
    success: true,
    Paid: true,
    Attested: true,
    Message: 'This withdrawal was paid by Bitcoin transaction PIN_TX.',
    Status: 'Completed',
    NothingToDo: true,
    NotMinedYet: false,
    VFXTransactionHash: 'VFX_DONE',
    BTCTransactionHash: 'PIN_TX',
    PinnedBTCTransactionHash: null,
    Withdrawal: withdrawal({ State: 'Settled', CanRaiseFee: false, CanRelease: false }),
  });

/** A node answer with `Success: false`, which Spyglass nests under `raw` with HTTP 500. */
const failed = (raw: Record<string, unknown>): Response =>
  jsonResponse({ success: false, message: raw.Message, raw: { Success: false, Attested: true, ...raw } }, 500);

const released = (): Response =>
  failed({
    Paid: false,
    Message: 'This withdrawal was given up by its requester.',
    Status: 'Closed',
    NothingToDo: true,
    NotMinedYet: false,
    Withdrawal: withdrawal({ State: 'Released', CanRaiseFee: false, CanRelease: false }),
  });

const notMinedYet = (): Response =>
  failed({
    Paid: false,
    Message: '[NOT-MINED-YET] Withdrawal request WR_HASH is not recorded on vault sc-1.',
    Status: 'Unknown',
    NothingToDo: false,
    NotMinedYet: true,
    Withdrawal: null,
  });

const frostPreparation = (): Response =>
  jsonResponse({
    success: true,
    SessionId: 'SES',
    StartMessage: 'START',
    StartTimestamp: 1,
    ShareDistributionMessage: 'SHARE',
    ShareDistributionTimestamp: 2,
    Amount: 0.001,
    BTCDestination: 'bc1q',
    FeeRate: 4,
  });

/** Answers in turn, repeating the last one. */
function sequence(...answers: Array<() => Response>): FetchHandler {
  let call = 0;
  return () => answers[Math.min(call++, answers.length - 1)]();
}

async function bodyOf(response: Response): Promise<unknown> {
  return response.json();
}

let client: VfxClient;
let privateKey: string;
let requestorAddress: string;

beforeEach(() => {
  client = new VfxClient('testnet');
  privateKey = client.generatePrivateKey();
  requestorAddress = client.addressFromPrivate(privateKey);
});

afterEach(() => {
  jest.resetAllMocks();
});

const completeParams = () => ({
  scIdentifier: 'sc-1',
  requestorAddress,
  withdrawalRequestHash: 'WR_HASH',
  btcAddress: 'bc1qBTC',
  amount: 0.001,
  feeRate: 4,
  privateKey,
  pollIntervalMs: 1,
  timeoutMs: 1000,
});

function touchedFrostOrType28(calls: CapturedCall[]): boolean {
  return calls.some((call) =>
    ['/withdraw/complete/execute/', '/withdraw/complete/tx/', '/btc/broadcast/'].some((path) =>
      call.url.includes(path),
    ),
  );
}

describe('parseWatchedWithdrawal', () => {
  test('reads a pinned answer spread into the Spyglass body', async () => {
    const parsed = parseWatchedWithdrawal(await bodyOf(pinned()));
    expect(parsed).toMatchObject({
      status: 'Awaiting_BTC_Confirmation',
      paid: false,
      closed: false,
      state: 'Pinned',
      feeRate: 4,
      minimumNextFeeRate: 5,
      canRaiseFee: true,
      canRelease: true,
      pinnedBtcTransactionHash: 'PIN_TX',
      btcTransactionHash: null,
      message: 'This withdrawal is paid by Bitcoin transaction PIN_TX.',
    });
    expect(parsed?.transactions).toEqual([
      {
        txid: 'PIN_TX',
        kind: 'Payment',
        feeRate: 4,
        feeSats: 600,
        superseded: false,
        dead: false,
        confirmed: false,
      },
    ]);
  });

  test('reads a closed answer nested under raw', async () => {
    expect(parseWatchedWithdrawal(await bodyOf(released()))).toMatchObject({
      status: 'Closed',
      paid: false,
      closed: true,
      state: 'Released',
    });
  });

  test('a not-mined-yet answer is neither paid nor closed', async () => {
    expect(parseWatchedWithdrawal(await bodyOf(notMinedYet()))).toMatchObject({
      notMinedYet: true,
      closed: false,
      state: null,
    });
  });

  test('a FROST preparation is not a watched answer', async () => {
    expect(parseWatchedWithdrawal(await bodyOf(frostPreparation()))).toBeNull();
    expect(parseWatchedWithdrawal(null)).toBeNull();
  });
});

describe('getWithdrawalPin', () => {
  test('returns the state for a watched vault, including a closed one answered with HTTP 500', async () => {
    installFetch({ [PREPARE]: sequence(pinned, released) });
    const params = { scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', requestorAddress };
    expect((await client.getWithdrawalPin(params))?.state).toBe('Pinned');
    expect((await client.getWithdrawalPin(params))?.state).toBe('Released');
  });

  test('returns null for a vault the chain does not watch', async () => {
    installFetch({ [PREPARE]: frostPreparation });
    expect(
      await client.getWithdrawalPin({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', requestorAddress }),
    ).toBeNull();
  });

  test('a 500 that is not JSON still throws', async () => {
    installFetch({ [PREPARE]: () => textResponse('Bad Gateway', 500) });
    await expect(
      client.getWithdrawalPin({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', requestorAddress }),
    ).rejects.toThrow(/status: 500/);
  });
});

describe('completeWithdrawal on a watched vault', () => {
  test('polls until Bitcoin pays it, with no ceremony and no Type 28', async () => {
    const { calls } = installFetch({ [PREPARE]: sequence(notMinedYet, pinned, pinned, paid) });
    const phases: string[] = [];
    const result = await client.completeWithdrawal({
      ...completeParams(),
      onProgress: (event) => phases.push(event.phase),
    });
    expect(result).toEqual({
      withdrawalRequestHash: 'WR_HASH',
      btcTransactionHash: 'PIN_TX',
      completionTransactionHash: 'VFX_DONE',
    });
    expect(touchedFrostOrType28(calls)).toBe(false);
    expect(phases.filter((phase) => phase === 'watched_polling')).toHaveLength(4);
  });

  test('a withdrawal closed unpaid throws VbtcWithdrawalClosedError', async () => {
    const { calls } = installFetch({ [PREPARE]: sequence(pinned, released) });
    await expect(client.completeWithdrawal(completeParams())).rejects.toMatchObject({
      name: 'VbtcWithdrawalClosedError',
      withdrawalRequestHash: 'WR_HASH',
    });
    expect(touchedFrostOrType28(calls)).toBe(false);
  });

  test('not paid within timeoutMs throws VbtcWithdrawalPendingError with the last state', async () => {
    installFetch({ [PREPARE]: pinned });
    const error = await client.completeWithdrawal({ ...completeParams(), pollIntervalMs: 5, timeoutMs: 30 }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(VbtcWithdrawalPendingError);
    expect(error.withdrawal.state).toBe('Pinned');
    expect(error.message).toMatch(/Nothing needs to be done/);
  });

  test('requestWithdrawal passes the watched outcome through instead of calling it incomplete', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      [PREPARE]: sequence(pinned, released),
    });
    const { withdrawalRequestHash, ...params } = completeParams();
    expect(withdrawalRequestHash).toBe('WR_HASH');
    await expect(client.requestWithdrawal(params)).rejects.toBeInstanceOf(VbtcWithdrawalClosedError);
  });
});

describe('bumpWithdrawalFee and releaseWithdrawal', () => {
  function installRaw(): { calls: CapturedCall[] } {
    return installFetch({
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'BUMP_HASH' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
    });
  }

  function hashedTx(calls: CapturedCall[]): Record<string, unknown> | undefined {
    const body = calls.find((call) => call.url.includes('/raw/hash/'))?.body as
      | { transaction: Record<string, unknown> }
      | undefined;
    return body?.transaction;
  }

  test.each([
    ['bumpWithdrawalFee', 'VBTCWithdrawalFeeBump()'],
    ['releaseWithdrawal', 'VBTCWithdrawalRelease()'],
  ] as const)('%s sends a Type 44 to the requester itself', async (method, fn) => {
    const { calls } = installRaw();
    const dry = new VfxClient('testnet', { dryRun: true });
    const hash = await dry[method]({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', feeRate: 9, privateKey });
    expect(hash).toBe('BUMP_HASH');
    const tx = hashedTx(calls);
    expect(tx).toMatchObject({
      TransactionType: 44,
      FromAddress: requestorAddress,
      ToAddress: requestorAddress,
      Amount: 0,
      Data: { Function: fn, ContractUID: 'sc-1', WithdrawalRequestHash: 'WR_HASH', FeeRate: 9 },
    });
  });

  test.each([0, -1, 2.5, 5001])('refuses a fee rate of %p before any request', async (feeRate) => {
    const { calls } = installRaw();
    await expect(
      client.bumpWithdrawalFee({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', feeRate, privateKey }),
    ).rejects.toThrow(/feeRate must be a whole number of sat\/vB from 1 to 5000/);
    expect(calls).toHaveLength(0);
  });
});
