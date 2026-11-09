import { VfxClient, VbtcFrostJobNotFoundError, VbtcWithdrawalAlreadySignedError, frostResumeActionFor } from '../index';
import { VbtcProgressEvent, VbtcWithdrawalCheckpoint } from '../types';
import { CapturedCall, installFetch } from './helpers/mock-fetch';

let client: VfxClient;
let privateKey: string;
let requestorAddress: string;

beforeEach(() => {
  client = new VfxClient('testnet');
  privateKey = client.generatePrivateKey();
  requestorAddress = client.addressFromPrivate(privateKey);
});
afterEach(() => jest.restoreAllMocks());

const params = (extra: Record<string, unknown> = {}) => ({
  scIdentifier: 'sc-1',
  requestorAddress,
  withdrawalRequestHash: 'WR_HASH',
  btcAddress: 'tb1qdest',
  amount: 0.001,
  feeRate: 10,
  privateKey,
  pollIntervalMs: 1,
  timeoutMs: 2000,
  ...extra,
});

const frostMocks = (overrides: Record<string, (url: string) => unknown> = {}) => ({
  '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
    success: true,
    SessionId: 'SES_W',
    StartMessage: 'FROST_START',
    StartTimestamp: 100,
    ShareDistributionMessage: 'FROST_SHARE',
    ShareDistributionTimestamp: 101,
  }),
  '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_NEW' }),
  '/btc/vbtc-v2/withdraw/complete/status/': () => ({
    success: true,
    status: 'complete',
    signed_btc_tx_hex: 'DEADBEEF',
  }),
  '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID' }),
  '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: true, Hash: 'CP', Fee: 1 }),
  '/btc/vbtc-v2/withdraw/complete/tx/send/': () => ({ success: true, Hash: 'COMPLETION_HASH' }),
  ...overrides,
});
const hit = (calls: CapturedCall[], part: string) => calls.some((c) => c.url.includes(part));

describe('frostResumeActionFor', () => {
  test('matches the Flutter guard', () => {
    expect(frostResumeActionFor(null)).toBe('ceremony');
    expect(frostResumeActionFor({ status: 'requested', btc_transaction_hash: '', signed_at: null })).toBe('ceremony');
    expect(frostResumeActionFor({ status: 'pending_btc', btc_transaction_hash: '', signed_at: null })).toBe('refuse');
    expect(
      frostResumeActionFor({ status: 'requested', btc_transaction_hash: '', signed_at: '2026-11-08T00:00:00Z' }),
    ).toBe('refuse');
    expect(
      frostResumeActionFor({ status: 'PENDING_BTC ' as never, btc_transaction_hash: 'abc', signed_at: null }),
    ).toBe('completion-only');
  });
});

describe('completeWithdrawal checkpoints', () => {
  test('frost-job-started is saved before polling, btc-broadcast before the Type 28', async () => {
    const order: string[] = [];
    const { calls } = installFetch(frostMocks());
    const checkpoints: VbtcWithdrawalCheckpoint[] = [];
    await client.completeWithdrawal(
      params({
        onCheckpoint: async (c: VbtcWithdrawalCheckpoint) => {
          checkpoints.push(c);
          order.push(`${c.kind}@${calls.length}`);
        },
      }),
    );
    const executeAt = calls.findIndex((c) => c.url.includes('/complete/execute/'));
    const firstStatusAt = calls.findIndex((c) => c.url.includes('/complete/status/'));
    const completionPrepareAt = calls.findIndex((c) => c.url.includes('/complete/tx/prepare/'));
    expect(order[0]).toBe(`frost-job-started@${executeAt + 1}`);
    expect(executeAt + 1).toBe(firstStatusAt);
    expect(order[1]).toBe(`btc-broadcast@${completionPrepareAt}`);
    expect(checkpoints[0]).toMatchObject({ jobId: 'JOB_NEW', amount: 0.001, btcAddress: 'tb1qdest' });
    expect(checkpoints[1]).toMatchObject({ btcTransactionHash: 'BTC_TXID', signedBtcTxHex: 'DEADBEEF' });
  });

  test('a throwing hook is reported and the withdrawal carries on', async () => {
    installFetch(frostMocks());
    const events: VbtcProgressEvent[] = [];
    const result = await client.completeWithdrawal(
      params({
        onCheckpoint: () => {
          throw new Error('storage full');
        },
        onProgress: (e: VbtcProgressEvent) => events.push(e),
      }),
    );
    expect(result.completionTransactionHash).toBe('COMPLETION_HASH');
    expect(events.filter((e) => e.phase === 'checkpoint_failed')).toHaveLength(2);
  });
});

describe('completeWithdrawal resumeJobId', () => {
  test('resumes polling the given job without preparing or signing again', async () => {
    const { calls } = installFetch(frostMocks());
    const result = await client.completeWithdrawal(params({ resumeJobId: 'JOB_OLD' }));
    expect(result.btcTransactionHash).toBe('BTC_TXID');
    expect(hit(calls, '/complete/prepare/')).toBe(false);
    expect(hit(calls, '/complete/execute/')).toBe(false);
    expect(calls.filter((c) => c.url.includes('/complete/status/')).every((c) => c.url.includes('JOB_OLD'))).toBe(true);
  });

  test('"Job not found" throws VbtcFrostJobNotFoundError and nothing is signed', async () => {
    const { calls } = installFetch(
      frostMocks({ '/btc/vbtc-v2/withdraw/complete/status/': () => ({ success: false, message: 'Job not found' }) }),
    );
    await expect(client.completeWithdrawal(params({ resumeJobId: 'JOB_GONE' }))).rejects.toBeInstanceOf(
      VbtcFrostJobNotFoundError,
    );
    expect(hit(calls, '/complete/execute/')).toBe(false);
    expect(hit(calls, '/btc/broadcast/')).toBe(false);
  });
});

describe('completeWithdrawal resignGuard', () => {
  const row = (extra: Record<string, unknown>) => () => ({
    results: [{ request_transaction_hash: 'WR_HASH', status: 'requested', btc_transaction_hash: '', ...extra }],
  });

  test('a signed row with a txid only records the completion', async () => {
    const { calls } = installFetch(
      frostMocks({ '/vbtc-v2/withdrawals/sc-1/': row({ status: 'pending_btc', btc_transaction_hash: 'SEEN_TXID' }) }),
    );
    const result = await client.completeWithdrawal(params({ resignGuard: true }));
    expect(result.btcTransactionHash).toBe('SEEN_TXID');
    expect(hit(calls, '/complete/execute/')).toBe(false);
    expect(hit(calls, '/btc/broadcast/')).toBe(false);
  });

  test('a signed row without a txid refuses, signing nothing', async () => {
    const { calls } = installFetch(
      frostMocks({ '/vbtc-v2/withdrawals/sc-1/': row({ signed_at: '2026-11-08T01:00:00Z' }) }),
    );
    await expect(client.completeWithdrawal(params({ resignGuard: true }))).rejects.toBeInstanceOf(
      VbtcWithdrawalAlreadySignedError,
    );
    expect(hit(calls, '/complete/execute/')).toBe(false);
  });

  test('an unreadable row lets signing go ahead; without the option the row is never read', async () => {
    const { calls } = installFetch(
      frostMocks({ '/vbtc-v2/withdrawals/': () => new Response('down', { status: 502 }) }),
    );
    await client.completeWithdrawal(params({ resignGuard: true }));
    expect(hit(calls, '/complete/execute/')).toBe(true);

    const plain = installFetch(frostMocks());
    await client.completeWithdrawal(params());
    expect(hit(plain.calls, '/vbtc-v2/withdrawals/')).toBe(false);
  });
});

describe('frostTimeoutMs', () => {
  test('bounds the FROST job separately from timeoutMs', async () => {
    installFetch(
      frostMocks({ '/btc/vbtc-v2/withdraw/complete/status/': () => ({ success: true, status: 'signing' }) }),
    );
    const started = Date.now();
    await expect(client.completeWithdrawal(params({ timeoutMs: 60_000, frostTimeoutMs: 50 }))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('Greptile review fixes', () => {
  test('a resumed job that signed a different withdrawal is refused before broadcasting', async () => {
    const { calls } = installFetch(
      frostMocks({
        '/btc/vbtc-v2/withdraw/complete/status/': () => ({
          success: true,
          status: 'complete',
          signed_btc_tx_hex: 'DEADBEEF',
          sc_identifier: 'sc-1',
          withdrawal_request_hash: 'OTHER_REQUEST',
        }),
      }),
    );
    await expect(client.completeWithdrawal(params({ resumeJobId: 'JOB_A' }))).rejects.toThrow(/nothing was broadcast/);
    expect(hit(calls, '/btc/broadcast/')).toBe(false);
  });

  test('a job naming this withdrawal goes ahead', async () => {
    installFetch(
      frostMocks({
        '/btc/vbtc-v2/withdraw/complete/status/': () => ({
          success: true,
          status: 'complete',
          signed_btc_tx_hex: 'DEADBEEF',
          sc_identifier: 'sc-1',
          withdrawal_request_hash: 'WR_HASH',
        }),
      }),
    );
    expect((await client.completeWithdrawal(params({ resumeJobId: 'JOB_A' }))).btcTransactionHash).toBe('BTC_TXID');
  });
});
