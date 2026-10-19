import { VbtcWatchedWithdrawal, VbtcWatchedWithdrawalTransaction } from '../types';

/**
 * Withdrawals from a vBTC V2 vault the chain watches (Core 9.0 Bitcoin
 * attestation). The requester sends the request and nothing else: the chain
 * fixes ("pins") the Bitcoin transaction that pays it, the vault's signers
 * sign and broadcast it on their own, and it completes when Bitcoin confirms
 * it. There is no FROST ceremony and the node refuses a Type 28 completion.
 * The requester can raise the fee of a pinned transaction that is not
 * confirming, or give the withdrawal up (a release), each with one Type 44.
 */

/** Core's `BtcCanonicalWithdrawal.MaxFeeRate` (sat/vB): a rate above it is refused. */
export const VBTC_WATCHED_MAX_FEE_RATE = 5000;

/** Core's `BtcWithdrawals.FeeBumpFunction` / `ReleaseFunction`. */
export const VBTC_FEE_BUMP_FUNCTION = 'VBTCWithdrawalFeeBump()';
export const VBTC_RELEASE_FUNCTION = 'VBTCWithdrawalRelease()';

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Drops the node's leading `[MARKER]` from a completion message. */
function withoutMarker(message: string | null): string | null {
  return message === null ? null : message.replace(/^\[[A-Z-]+\]\s*/, '');
}

function parseTransaction(json: Json): VbtcWatchedWithdrawalTransaction {
  return {
    txid: asString(json.Txid) ?? '',
    kind: json.Kind === 'Release' ? 'Release' : 'Payment',
    feeRate: asNumber(json.FeeRate),
    feeSats: asNumber(json.FeeSats),
    superseded: json.Superseded === true,
    dead: json.Dead === true,
    confirmed: json.Confirmed === true,
  };
}

/**
 * The withdrawal's state from the node's answer to `PrepareCompleteWithdrawalRaw`
 * (Core `BtcVaultView.CompletionAnswer`, proxied by Spyglass as
 * `/btc/vbtc-v2/withdraw/complete/prepare/`), or null when the vault is not
 * watched (the answer is then a FROST preparation). Spyglass spreads a
 * successful node answer into its own body and nests a failed one under `raw`,
 * so both shapes are read.
 */
export function parseWatchedWithdrawal(response: unknown): VbtcWatchedWithdrawal | null {
  const body = asObject(response);
  if (!body) return null;
  const raw = asObject(body.raw);
  const answer = body.Attested === true ? body : raw?.Attested === true ? raw : null;
  if (!answer) return null;

  const withdrawal = asObject(answer.Withdrawal);
  const transactions = Array.isArray(withdrawal?.Transactions)
    ? (withdrawal?.Transactions as unknown[])
        .map(asObject)
        .filter((t): t is Json => t !== null)
        .map(parseTransaction)
    : [];
  const state = asString(withdrawal?.State);
  const paid = answer.Paid === true;
  const feeRate = asNumber(withdrawal?.FeeRate);

  return {
    status: asString(answer.Status) ?? 'Unknown',
    paid,
    notMinedYet: answer.NotMinedYet === true,
    closed: paid || (state !== null && state !== 'Pinned' && state !== 'Waiting'),
    message: withoutMarker(asString(answer.Message)),
    state,
    summary: asString(withdrawal?.Summary),
    feeRate,
    minimumNextFeeRate: (feeRate ?? 0) + 1,
    canRaiseFee: withdrawal?.CanRaiseFee === true,
    canRelease: withdrawal?.CanRelease === true,
    releasing: withdrawal?.Releasing === true,
    canCancel: withdrawal?.CanCancel === true,
    pinnedBtcTransactionHash: asString(answer.PinnedBTCTransactionHash),
    btcTransactionHash: asString(answer.BTCTransactionHash),
    completionTransactionHash: asString(answer.VFXTransactionHash),
    transactions,
  };
}

/**
 * Whether a completion-route answer says Spyglass could not reach the node (a
 * timeout, a refused connection): no answer at all, so neither "watched" nor
 * "not watched". Spyglass marks it `Unreachable` in the body it nests under
 * `raw` with HTTP 500.
 */
export function isUnreachableAnswer(response: unknown): boolean {
  const body = asObject(response);
  return body?.Unreachable === true || asObject(body?.raw)?.Unreachable === true;
}

/** Throws unless `feeRate` is a whole sat/vB rate the node could accept. */
export function assertWatchedFeeRate(feeRate: number, label: string): void {
  if (!Number.isInteger(feeRate) || feeRate <= 0 || feeRate > VBTC_WATCHED_MAX_FEE_RATE) {
    throw new Error(`${label}: feeRate must be a whole number of sat/vB from 1 to ${VBTC_WATCHED_MAX_FEE_RATE}`);
  }
}

/**
 * The `Data` of the Type 44 (VBTC_V2_COIN_PIN) transaction that raises a
 * pinned withdrawal's Bitcoin fee, or with `release` gives it up. Mirrors
 * Core's `VBTCService.BuildWithdrawalFeeBumpTx`; the requester sends it to
 * itself with no amount.
 */
export function watchedWithdrawalFeeBumpData(params: {
  scIdentifier: string;
  withdrawalRequestHash: string;
  feeRate: number;
  release: boolean;
}): Json {
  return {
    Function: params.release ? VBTC_RELEASE_FUNCTION : VBTC_FEE_BUMP_FUNCTION,
    ContractUID: params.scIdentifier,
    WithdrawalRequestHash: params.withdrawalRequestHash,
    FeeRate: params.feeRate,
  };
}
