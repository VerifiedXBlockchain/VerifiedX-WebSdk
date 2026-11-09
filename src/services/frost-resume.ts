import { VbtcWithdrawalRequest } from '../types';

/**
 * What a vBTC V2 withdrawal may safely do next when no local record says, read
 * from the explorer's row for the request (null when it could not be read).
 * Ported from the Flutter web wallet's `frostResumeActionFor`
 * (lib/features/btc_web/services/frost_resume_guard.dart).
 *
 * - `ceremony`: nothing has been signed; a fresh signing is safe.
 * - `completion-only`: a signed Bitcoin transaction exists and the row names
 *   it, so only the Type 28 completion remains.
 * - `refuse`: signing has already run and nothing here can finish it;
 *   signing again risks paying the withdrawal twice.
 *
 * Either `signed_at` or status `pending_btc` counts as signed: requiring both
 * would fail open against an explorer that has one but not yet the other.
 * An unreadable row allows the ceremony, because every first withdrawal
 * reaches this point with no record and a transient error must not block it.
 */
export type FrostResumeAction = 'ceremony' | 'completion-only' | 'refuse';

export function frostResumeActionFor(
  row: Pick<VbtcWithdrawalRequest, 'status' | 'btc_transaction_hash' | 'signed_at'> | null,
): FrostResumeAction {
  if (!row) return 'ceremony';
  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
  const signedAt = typeof row.signed_at === 'string' && row.signed_at.trim() !== '';
  if (!signedAt && status !== 'pending_btc') return 'ceremony';
  return typeof row.btc_transaction_hash === 'string' && row.btc_transaction_hash.trim() !== ''
    ? 'completion-only'
    : 'refuse';
}
