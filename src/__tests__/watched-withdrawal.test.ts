/**
 * Withdrawals from a vault the chain watches (Core 9.0 Bitcoin attestation).
 * The node answers the completion route with the withdrawal's state
 * (`BtcVaultView.CompletionAnswer`) instead of a FROST preparation, and
 * refuses a Type 28 completion, so the SDK polls for payment and offers fee
 * bump and release (Type 44) instead.
 */
import {
  TransactionRefusedError,
  VbtcNodeUnreachableError,
  VbtcWithdrawalClosedError,
  VfxClient,
  parseWatchedWithdrawal,
} from '../index';
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

  test('an Unreachable answer throws instead of reading as not watched', async () => {
    installFetch({
      [PREPARE]: () =>
        jsonResponse({ success: false, message: 'timed out', raw: { Success: false, Unreachable: true } }, 500),
    });
    await expect(
      client.getWithdrawalPin({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', requestorAddress }),
    ).rejects.toBeInstanceOf(VbtcNodeUnreachableError);
  });

  test('a 500 that is not JSON still throws', async () => {
    installFetch({ [PREPARE]: () => textResponse('Bad Gateway', 500) });
    await expect(
      client.getWithdrawalPin({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', requestorAddress }),
    ).rejects.toThrow(/status: 500/);
  });
});

describe('completeWithdrawal on a watched vault', () => {
  test('waits for the request to be recorded, then resolves paid when Bitcoin has paid it', async () => {
    const { calls } = installFetch({ [PREPARE]: sequence(notMinedYet, notMinedYet, paid) });
    const phases: string[] = [];
    const result = await client.completeWithdrawal({
      ...completeParams(),
      onProgress: (event) => phases.push(event.phase),
    });
    expect(result).toMatchObject({
      withdrawalRequestHash: 'WR_HASH',
      btcTransactionHash: 'PIN_TX',
      completionTransactionHash: 'VFX_DONE',
      paid: true,
    });
    expect(result.watched?.state).toBe('Settled');
    expect(touchedFrostOrType28(calls)).toBe(false);
    expect(phases.filter((phase) => phase === 'watched_polling')).toHaveLength(3);
  });

  test('a withdrawal being paid resolves paid: false with its state, without throwing', async () => {
    const { calls } = installFetch({ [PREPARE]: sequence(notMinedYet, pinned) });
    const result = await client.completeWithdrawal(completeParams());
    expect(result).toMatchObject({
      withdrawalRequestHash: 'WR_HASH',
      btcTransactionHash: '',
      completionTransactionHash: '',
      paid: false,
    });
    expect(result.watched).toMatchObject({ state: 'Pinned', pinnedBtcTransactionHash: 'PIN_TX', canRaiseFee: true });
    expect(touchedFrostOrType28(calls)).toBe(false);
  });

  test('a request still not mined at timeoutMs resolves paid: false rather than throwing', async () => {
    installFetch({ [PREPARE]: notMinedYet });
    const result = await client.completeWithdrawal({ ...completeParams(), pollIntervalMs: 5, timeoutMs: 30 });
    expect(result.paid).toBe(false);
    expect(result.watched?.notMinedYet).toBe(true);
  });

  test('rides out a failed request and an Unreachable answer until the deadline', async () => {
    const unreachable = (): Response =>
      jsonResponse(
        {
          success: false,
          message: 'Read timed out',
          raw: { Success: false, Message: 'Read timed out', Unreachable: true },
        },
        500,
      );
    const lost = (): Response => {
      throw new TypeError('fetch failed');
    };
    installFetch({
      [PREPARE]: sequence(notMinedYet, lost, unreachable, () => textResponse('Bad Gateway', 502), pinned),
    });
    const result = await client.completeWithdrawal(completeParams());
    expect(result.paid).toBe(false);
    expect(result.watched?.state).toBe('Pinned');
  });

  test('a pending result after reads ran out carries the last error', async () => {
    const lost = (): Response => {
      throw new TypeError('fetch failed');
    };
    installFetch({ [PREPARE]: sequence(notMinedYet, lost) });
    const result = await client.completeWithdrawal({ ...completeParams(), pollIntervalMs: 5, timeoutMs: 40 });
    expect(result.paid).toBe(false);
    expect(result.lastError).toBe('fetch failed');
    expect(result.watched?.notMinedYet).toBe(true);
  });

  test('the first read is retried through a failed request and an Unreachable answer', async () => {
    const lost = (): Response => {
      throw new TypeError('fetch failed');
    };
    const unreachable = (): Response =>
      jsonResponse({ success: false, message: 'timed out', raw: { Success: false, Unreachable: true } }, 500);
    const { calls } = installFetch({ [PREPARE]: sequence(lost, unreachable, pinned) });
    const result = await client.completeWithdrawal(completeParams());
    expect(result).toMatchObject({ paid: false, watched: { state: 'Pinned' } });
    expect(result.lastError).toBeUndefined();
    expect(calls.filter((call) => call.url.includes(PREPARE))).toHaveLength(3);
    expect(touchedFrostOrType28(calls)).toBe(false);
  });

  test('a first read still Unreachable at the deadline throws, taking it as neither watched nor FROST', async () => {
    const { calls } = installFetch({
      [PREPARE]: () =>
        jsonResponse({ success: false, message: 'timed out', raw: { Success: false, Unreachable: true } }, 500),
    });
    await expect(
      client.completeWithdrawal({ ...completeParams(), pollIntervalMs: 5, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(VbtcNodeUnreachableError);
    expect(touchedFrostOrType28(calls)).toBe(false);
  });

  test('a first read refused with a 4xx is not retried', async () => {
    const { calls } = installFetch({
      [PREPARE]: () => jsonResponse({ success: false, message: 'owner_address required' }, 400),
    });
    await expect(client.completeWithdrawal(completeParams())).rejects.toThrow(/status: 400/);
    expect(calls).toHaveLength(1);
  });

  test('stops on a real answer that the vault is not watched', async () => {
    installFetch({ [PREPARE]: sequence(notMinedYet, frostPreparation) });
    await expect(client.completeWithdrawal(completeParams())).rejects.toThrow(/now answers that it is not/);
  });

  test('a withdrawal closed unpaid throws VbtcWithdrawalClosedError', async () => {
    const { calls } = installFetch({ [PREPARE]: sequence(notMinedYet, released) });
    await expect(client.completeWithdrawal(completeParams())).rejects.toMatchObject({
      name: 'VbtcWithdrawalClosedError',
      withdrawalRequestHash: 'WR_HASH',
    });
    expect(touchedFrostOrType28(calls)).toBe(false);
  });

  test('requestWithdrawal resolves the pending result for a watched vault', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      [PREPARE]: sequence(notMinedYet, pinned),
    });
    const { withdrawalRequestHash, ...params } = completeParams();
    expect(withdrawalRequestHash).toBe('WR_HASH');
    const result = await client.requestWithdrawal(params);
    expect(result).toMatchObject({ withdrawalRequestHash: 'WR_HASH', paid: false });
  });

  test('requestWithdrawal passes a closed withdrawal through instead of calling it incomplete', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      [PREPARE]: released,
    });
    const { withdrawalRequestHash, ...params } = completeParams();
    expect(withdrawalRequestHash).toBe('WR_HASH');
    await expect(client.requestWithdrawal(params)).rejects.toBeInstanceOf(VbtcWithdrawalClosedError);
  });
});

describe('bumpWithdrawalFee and releaseWithdrawal', () => {
  function installRaw(overrides: Record<string, FetchHandler> = {}): { calls: CapturedCall[] } {
    return installFetch({
      [PREPARE]: pinned,
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'BUMP_HASH' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
      '/raw/send/': () => ({ Result: 'Success' }),
      ...overrides,
    });
  }

  function hashedTx(calls: CapturedCall[]): Record<string, unknown> | undefined {
    const body = calls.find((call) => call.url.includes('/raw/hash/'))?.body as
      | { transaction: Record<string, unknown> }
      | undefined;
    return body?.transaction;
  }

  const bump = (feeRate: number) => ({ scIdentifier: 'sc-1', withdrawalRequestHash: 'WR_HASH', feeRate, privateKey });

  test.each([
    ['bumpWithdrawalFee', 'VBTCWithdrawalFeeBump()'],
    ['releaseWithdrawal', 'VBTCWithdrawalRelease()'],
  ] as const)('%s reads the withdrawal, then sends a Type 44 to the requester itself', async (method, fn) => {
    const { calls } = installRaw();
    expect(await client[method](bump(9))).toBe('BUMP_HASH');
    const prepare = calls.find((call) => call.url.includes(PREPARE));
    expect(prepare?.body).toMatchObject({ owner_address: requestorAddress, withdrawal_request_hash: 'WR_HASH' });
    expect(hashedTx(calls)).toMatchObject({
      TransactionType: 44,
      FromAddress: requestorAddress,
      ToAddress: requestorAddress,
      Amount: 0,
      Data: { Function: fn, ContractUID: 'sc-1', WithdrawalRequestHash: 'WR_HASH', FeeRate: 9 },
    });
  });

  test.each([0, -1, 2.5, 5001])('refuses a fee rate of %p before any request', async (feeRate) => {
    const { calls } = installRaw();
    await expect(client.bumpWithdrawalFee(bump(feeRate))).rejects.toThrow(
      /feeRate must be a whole number of sat\/vB from 1 to 5000/,
    );
    expect(calls).toHaveLength(0);
  });

  test('refuses a rate not above the pinned rate before building', async () => {
    const { calls } = installRaw();
    await expect(client.bumpWithdrawalFee(bump(4))).rejects.toThrow(/at least 5 sat\/vB/);
    expect(calls.some((call) => call.url.includes('/raw/'))).toBe(false);
  });

  test('refuses when the withdrawal cannot be raised or released now', async () => {
    const { calls } = installRaw({ [PREPARE]: released });
    await expect(client.bumpWithdrawalFee(bump(9))).rejects.toThrow(/cannot be raised now \(Released\)/);
    await expect(client.releaseWithdrawal(bump(9))).rejects.toThrow(/cannot be released now/);
    expect(calls.some((call) => call.url.includes('/raw/'))).toBe(false);
  });

  test('refuses on a vault the chain does not watch', async () => {
    installRaw({ [PREPARE]: frostPreparation });
    await expect(client.bumpWithdrawalFee(bump(9))).rejects.toThrow(/not one the chain watches/);
  });

  test("a refusal by the node throws TransactionRefusedError with the node's reason", async () => {
    const { calls } = installRaw({
      '/raw/verify/': () => ({ Result: 'Fail', Message: 'A release must beat the pinned fee by its relay cost.' }),
    });
    const error = await client.releaseWithdrawal(bump(9)).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(TransactionRefusedError);
    expect(error.reason).toBe('A release must beat the pinned fee by its relay cost.');
    expect(calls.some((call) => call.url.includes('/raw/send/'))).toBe(false);
  });
});
