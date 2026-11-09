import { VbtcV2Token, VbtcWithdrawalRequest } from '../types';
import {
  VBTC_MIN_WITHDRAWAL_TX_VBYTES,
  VBTC_MULTI_WITHDRAWAL_MAX_INPUTS,
  VBTC_WITHDRAWAL_DUST_SATS,
} from './vbtc-multi-withdrawal';

/**
 * Where a vBTC V2 withdrawal request stands, read from the explorer's rows.
 * Ported from the Flutter web wallet (lib/features/btc_web/models/
 * btc_web_vbtc_token.dart and utils/vbtc_multi_withdrawal.dart) so the new
 * wallet decides resume, cancel and Max the same way.
 */

const RESUMABLE_STATUSES = new Set(['requested', 'pending_btc']);

/**
 * Blocks after its request is mined that the chain still treats a request as
 * the vault's active one (Core `VBTCWithdrawalRequest.EXPIRY_BLOCKS`; the
 * node's check is `currentHeight - RequestBlockHeight <= EXPIRY_BLOCKS`).
 */
export const VBTC_WITHDRAWAL_EXPIRY_BLOCKS = 360;

/**
 * Wall-clock stand-in for the expiry when no block height is available:
 * about 72 minutes at 12 s blocks, rounded up so a request the chain still
 * considers live is never treated as stale.
 */
export const VBTC_WITHDRAWAL_STALE_AFTER_MS = 90 * 60 * 1000;

const SATS_PER_VBTC = 100_000_000;

/** `requested` or `pending_btc`, read case-insensitively: the request can still be finished. */
export function isWithdrawalResumable(row: Pick<VbtcWithdrawalRequest, 'status'>): boolean {
  return typeof row.status === 'string' && RESUMABLE_STATUSES.has(row.status.trim().toLowerCase());
}

/** A watched vault's open request as the node last described it. */
export type WatchedWithdrawalRowState = 'waiting' | 'pinned' | 'releasing' | 'unknown';

export function watchedWithdrawalRowState(
  row: Pick<VbtcWithdrawalRequest, 'pin_state' | 'releasing'>,
): WatchedWithdrawalRowState {
  if (row.releasing === true) return 'releasing';
  if (typeof row.pin_state !== 'string') return 'unknown';
  const state = row.pin_state.trim().toLowerCase();
  return state === 'waiting' || state === 'pinned' ? state : 'unknown';
}

/**
 * Whether a history row may offer Cancel. On a watched vault the chain takes
 * a cancel only while no Bitcoin transaction is fixed (`Waiting`); once one
 * is pinned only a release gives the withdrawal up.
 */
export function withdrawalRowCanCancel(
  row: Pick<VbtcWithdrawalRequest, 'status' | 'pin_state' | 'releasing'>,
  vaultIsWatched: boolean,
): boolean {
  if (!isWithdrawalResumable(row)) return false;
  if (!vaultIsWatched && (row.pin_state === null || row.pin_state === undefined)) return true;
  return watchedWithdrawalRowState(row) === 'waiting';
}

/**
 * True once the chain no longer treats the request as the vault's active one,
 * so a new request simply replaces it. With both heights this is the chain's
 * own rule; otherwise `created_at` plus VBTC_WITHDRAWAL_STALE_AFTER_MS, which
 * errs toward keeping a request resumable.
 */
export function isWithdrawalStale(
  row: Pick<VbtcWithdrawalRequest, 'created_at'>,
  opts: { now?: number; currentBlockHeight?: number | null; requestBlockHeight?: number | null } = {},
): boolean {
  const { currentBlockHeight, requestBlockHeight } = opts;
  if (typeof currentBlockHeight === 'number' && typeof requestBlockHeight === 'number' && requestBlockHeight > 0) {
    return currentBlockHeight - requestBlockHeight > VBTC_WITHDRAWAL_EXPIRY_BLOCKS;
  }
  const created = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
  if (!Number.isFinite(created)) return false;
  return (opts.now ?? Date.now()) - created > VBTC_WITHDRAWAL_STALE_AFTER_MS;
}

/** `address`'s own requests on a token that can still be finished. */
export function resumableWithdrawalsFor(
  token: Pick<VbtcV2Token, 'withdrawal_requests'>,
  address: string,
): VbtcWithdrawalRequest[] {
  if (!address) return [];
  return (token.withdrawal_requests ?? []).filter((w) => isWithdrawalResumable(w) && w.requestor_address === address);
}

/**
 * `address`'s requests that the chain still treats as the vault's active one,
 * so resuming is the only way forward. `requestBlockHeights` maps
 * `request_transaction_hash` to the height its request was mined at.
 */
export function liveResumableWithdrawalsFor(
  token: Pick<VbtcV2Token, 'withdrawal_requests'>,
  address: string,
  opts: { now?: number; currentBlockHeight?: number | null; requestBlockHeights?: Record<string, number> } = {},
): VbtcWithdrawalRequest[] {
  return resumableWithdrawalsFor(token, address).filter(
    (w) =>
      !isWithdrawalStale(w, {
        now: opts.now,
        currentBlockHeight: opts.currentBlockHeight,
        requestBlockHeight: opts.requestBlockHeights?.[w.request_transaction_hash],
      }),
  );
}

/**
 * The most one multi-vault request can withdraw from `balances` (vault id to
 * spendable vBTC): the sum of the largest VBTC_MULTI_WITHDRAWAL_MAX_INPUTS
 * balances that can each pay the smallest withdrawal transaction at
 * `feeRate` and still leave the 546-sat payout. A smaller vault would be a
 * share the request is refused for, so Max leaves it out. The fee rate
 * defaults to 1 sat/vB, the lowest, as the wallet asks for it after the amount.
 */
export function vbtcMultiWithdrawalMax(balances: Record<string, number>, feeRate = 1): number {
  const floor = feeRate * VBTC_MIN_WITHDRAWAL_TX_VBYTES + VBTC_WITHDRAWAL_DUST_SATS;
  const sats = Object.values(balances)
    .map((amount) => Math.round(amount * SATS_PER_VBTC))
    .filter((s) => s > 0 && s >= floor)
    .sort((a, b) => b - a);
  return sats.slice(0, VBTC_MULTI_WITHDRAWAL_MAX_INPUTS).reduce((sum, s) => sum + s, 0) / SATS_PER_VBTC;
}
