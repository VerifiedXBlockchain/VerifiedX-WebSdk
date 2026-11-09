import {
  VfxClient,
  isWithdrawalResumable,
  isWithdrawalStale,
  liveResumableWithdrawalsFor,
  vbtcMultiWithdrawalMax,
  watchedWithdrawalRowState,
  withdrawalRowCanCancel,
} from '../index';
import { VbtcV2Token, VbtcWithdrawalRequest } from '../types';
import { installFetch, jsonResponse } from './helpers/mock-fetch';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const row = (extra: Partial<VbtcWithdrawalRequest> = {}): VbtcWithdrawalRequest => ({
  id: 1,
  requestor_address: 'xMe',
  btc_address: 'tb1q',
  amount: '0.001',
  fee_rate: '5',
  btc_transaction_hash: '',
  status: 'requested',
  request_transaction_hash: 'REQ1',
  completion_transaction_hash: null,
  created_at: '2026-11-08T11:30:00Z',
  completed_at: null,
  ...extra,
});
const token = (rows: VbtcWithdrawalRequest[]) => ({ withdrawal_requests: rows } as unknown as VbtcV2Token);

afterEach(() => jest.restoreAllMocks());

describe('withdrawal row state (Flutter rules)', () => {
  test('resumable statuses, read case-insensitively', () => {
    expect(isWithdrawalResumable(row())).toBe(true);
    expect(isWithdrawalResumable(row({ status: 'PENDING_BTC ' as never }))).toBe(true);
    expect(isWithdrawalResumable(row({ status: 'completed' }))).toBe(false);
  });

  test('watched pin state, release first', () => {
    expect(watchedWithdrawalRowState(row({ pin_state: 'Waiting' }))).toBe('waiting');
    expect(watchedWithdrawalRowState(row({ pin_state: 'Pinned' }))).toBe('pinned');
    expect(watchedWithdrawalRowState(row({ pin_state: 'Pinned', releasing: true }))).toBe('releasing');
    expect(watchedWithdrawalRowState(row({ pin_state: null }))).toBe('unknown');
  });

  test('cancel: any open row on an unwatched vault, only Waiting on a watched one', () => {
    expect(withdrawalRowCanCancel(row(), false)).toBe(true);
    expect(withdrawalRowCanCancel(row({ pin_state: 'Waiting' }), true)).toBe(true);
    expect(withdrawalRowCanCancel(row({ pin_state: 'Pinned' }), true)).toBe(false);
    expect(withdrawalRowCanCancel(row({ status: 'completed' }), false)).toBe(false);
  });

  test('stale by the chain rule with heights, by 90 minutes without', () => {
    expect(isWithdrawalStale(row(), { currentBlockHeight: 1361, requestBlockHeight: 1000 })).toBe(true);
    expect(isWithdrawalStale(row(), { currentBlockHeight: 1360, requestBlockHeight: 1000 })).toBe(false);
    expect(isWithdrawalStale(row({ created_at: '2026-11-08T10:29:00Z' }), { now: NOW })).toBe(true);
    expect(isWithdrawalStale(row({ created_at: '2026-11-08T10:31:00Z' }), { now: NOW })).toBe(false);
    expect(isWithdrawalStale(row({ created_at: 'not a date' }), { now: NOW })).toBe(false);
  });

  test('live resumable: mine, open, and not stale', () => {
    const rows = [
      row(),
      row({ request_transaction_hash: 'OLD', created_at: '2026-11-08T09:00:00Z' }),
      row({ request_transaction_hash: 'THEIRS', requestor_address: 'xThem' }),
      row({ request_transaction_hash: 'DONE', status: 'completed' }),
    ];
    expect(
      liveResumableWithdrawalsFor(token(rows), 'xMe', { now: NOW }).map((r) => r.request_transaction_hash),
    ).toEqual(['REQ1']);
  });
});

describe('vbtcMultiWithdrawalMax', () => {
  test('sums the ten largest vaults that clear the fee floor', () => {
    // 1 sat/vB: floor 154 + 546 = 700 sats.
    expect(vbtcMultiWithdrawalMax({ a: 0.001, b: 0.000007, c: 0.00000699 })).toBe(0.001007);
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`v${i}`, (i + 1) / 1e5]));
    expect(vbtcMultiWithdrawalMax(eleven)).toBe((2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11) / 1e5);
    // 10 sat/vB: floor 2,086 sats.
    expect(vbtcMultiWithdrawalMax({ a: 0.00002085, b: 0.00002086 }, 10)).toBe(0.00002086);
  });
});

describe('getLiveResumableWithdrawals', () => {
  test('judges each request by the latest block and its own mined height', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const rows = [
      row({ request_transaction_hash: 'FRESH', created_at: '2026-11-08T08:00:00Z' }),
      row({ request_transaction_hash: 'EXPIRED' }),
      row({ request_transaction_hash: 'UNKNOWN', created_at: '2026-11-08T11:50:00Z' }),
    ];
    installFetch({
      '/btc/vbtc-v2/detail/': () => ({ sc_identifier: 'sc-1', withdrawal_requests: rows }),
      '/blocks/': () => ({ count: 1, page: 1, num_pages: 1, results: [{ height: 2000 }] }),
      '/transaction/FRESH/': () => ({ hash: 'FRESH', height: 1900 }),
      '/transaction/EXPIRED/': () => ({ hash: 'EXPIRED', height: 1500 }),
      '/transaction/UNKNOWN/': () => jsonResponse({ detail: 'Not found.' }, 404),
    });
    const live = await new VfxClient('testnet').getLiveResumableWithdrawals(token(rows), 'xMe');
    expect(live.map((r) => r.request_transaction_hash)).toEqual(['FRESH', 'UNKNOWN']);
  });
});

describe('Greptile review fixes', () => {
  test('height lookups run concurrently, so one slow lookup does not delay the others', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const rows = ['A', 'B', 'C'].map((hash) => row({ request_transaction_hash: hash }));
    let inFlight = 0;
    let peak = 0;
    installFetch({
      '/blocks/': () => ({ count: 1, page: 1, num_pages: 1, results: [{ height: 2000 }] }),
      '/transaction/': async (url: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { hash: url, height: 1990 };
      },
    } as never);
    const live = await new VfxClient('testnet').getLiveResumableWithdrawals(token(rows), 'xMe');
    expect(live).toHaveLength(3);
    expect(peak).toBe(3);
  });
});
