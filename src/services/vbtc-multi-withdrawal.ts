import * as bitcoin from 'bitcoinjs-lib';
import { Network } from '../constants';
import { VbtcWatchedWithdrawal, VbtcWithdrawalShareOutcome } from '../types';
import { VbtcAllocationInput } from './vbtc-multi';

/**
 * Multi-vault vBTC withdrawals (Core 9.0): one Type 27 transaction that
 * withdraws a total to one Bitcoin address from several vaults the requester
 * holds vBTC in. The chain opens one share per vault under the request's hash,
 * and each share is paid by its own Bitcoin transaction, so each pays its own
 * miner fee and the shares settle independently. Mirrors Core's
 * `VBTCService.BuildMultiWithdrawalTxData` and the validator's
 * `ValidateVbtcV2MultiWithdrawalRequest`.
 */

/** Core's `VBTCService.MultiWithdrawalFunction`. */
export const VBTC_MULTI_WITHDRAWAL_FUNCTION = 'VBTCWithdrawalRequestMultiV2()';
/** Core's `VBTCService.MaxMultiWithdrawalInputs`: the node refuses more shares than this. */
export const VBTC_MULTI_WITHDRAWAL_MAX_INPUTS = 10;
/** Core's `VBTCService.MinWithdrawalTxVBytes`: the smallest withdrawal transaction. */
export const VBTC_MIN_WITHDRAWAL_TX_VBYTES = 154;
/**
 * The smallest payout a withdrawal share may leave after its fee: Core's
 * `BtcCanonicalWithdrawal.DustSats`. A watched vault's request is refused at
 * send below it (`BtcWithdrawals.Refusal`), although Core's builder checks only
 * its 330-sat `TaprootDustSats`. The SDK checks every share against 546, so a
 * request it signs is not refused for any vault.
 */
export const VBTC_WITHDRAWAL_DUST_SATS = 546;
/**
 * The most VFX a multi-vault request may cost before the SDK refuses to sign
 * it. The node's fee for one is about 0.00002 VFX; a much larger fee means the
 * fee route answered something unexpected.
 */
export const VBTC_MULTI_WITHDRAWAL_DEFAULT_MAX_FEE = 0.01;

const SATS_PER_VBTC = 100_000_000;

function toSats(amount: number): number {
  return Math.round(amount * SATS_PER_VBTC);
}

/**
 * Each share pays its Bitcoin fee out of its amount, so it must cover the
 * smallest withdrawal transaction at the fee rate and still leave a payout of
 * at least `VBTC_WITHDRAWAL_DUST_SATS`: the rule Core applies to a watched
 * vault's request when it is sent. Null when it does.
 */
export function withdrawalFeeFloorError(amount: number, feeRate: number, context: string): string | null {
  if (!(feeRate > 0) || !(amount > 0)) return null;
  const minFeeSats = feeRate * VBTC_MIN_WITHDRAWAL_TX_VBYTES;
  if (toSats(amount) - minFeeSats >= VBTC_WITHDRAWAL_DUST_SATS) return null;
  const minAmount = (minFeeSats + VBTC_WITHDRAWAL_DUST_SATS) / SATS_PER_VBTC;
  return (
    `${context}: ${amount} BTC cannot pay a Bitcoin withdrawal at ${feeRate} sat/vB. The smallest withdrawal ` +
    `transaction costs ${minFeeSats} sats in fees and the payout must be at least ${VBTC_WITHDRAWAL_DUST_SATS} sats, ` +
    `so the minimum at this fee rate is ${minAmount} BTC.`
  );
}

/**
 * Throws unless `btcAddress` is a Bitcoin address of `network`'s chain
 * (mainnet for mainnet, testnet/signet for testnet). The node refuses any
 * other only when the transaction is verified, so it is checked before
 * anything is built.
 */
export function assertBtcAddressOnNetwork(btcAddress: string, network: Network, label: string): void {
  const btcNetwork = network === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  try {
    bitcoin.address.toOutputScript(btcAddress, btcNetwork);
  } catch {
    throw new Error(
      `${label}: ${btcAddress} is not a Bitcoin address on ${network === Network.Mainnet ? 'mainnet' : 'testnet'}`,
    );
  }
}

/**
 * The `Data` of a multi-vault withdrawal request. Throws for anything the node
 * would refuse: no inputs, more than the cap, a repeated vault, an amount that
 * is not positive or has more than 8 decimals, a share below the fee floor, or
 * a total that is not the sum of the inputs.
 */
export function vbtcMultiWithdrawalData(params: {
  requestorAddress: string;
  btcAddress: string;
  totalAmount: number;
  feeRate: number;
  inputs: VbtcAllocationInput[];
}): Record<string, unknown> {
  const { inputs, feeRate } = params;
  if (inputs.length < 2) {
    throw new Error('A multi-vault withdrawal needs at least two vaults; withdraw from one with requestWithdrawal');
  }
  if (inputs.length > VBTC_MULTI_WITHDRAWAL_MAX_INPUTS) {
    throw new Error(`A multi-vault withdrawal may draw from at most ${VBTC_MULTI_WITHDRAWAL_MAX_INPUTS} vaults`);
  }
  if (!Number.isInteger(feeRate) || feeRate <= 0) {
    throw new Error('feeRate must be a whole number of sat/vB greater than zero');
  }
  if (new Set(inputs.map((i) => i.scIdentifier)).size !== inputs.length) {
    throw new Error('Multi-vault withdrawal inputs must name distinct vaults');
  }
  let sumSats = 0;
  for (const input of inputs) {
    if (!input.scIdentifier) {
      throw new Error('Every multi-vault withdrawal input needs a scIdentifier');
    }
    if (!(input.amount > 0)) {
      throw new Error('Every multi-vault withdrawal input amount must be greater than zero');
    }
    const sats = toSats(input.amount);
    if (sats / SATS_PER_VBTC !== input.amount) {
      throw new Error('Multi-vault withdrawal input amounts cannot have more than 8 decimal places');
    }
    const floor = withdrawalFeeFloorError(input.amount, feeRate, `Withdrawal share from vault ${input.scIdentifier}`);
    if (floor) {
      throw new Error(`${floor} Each share pays its own Bitcoin fee: raise the amount or lower the fee rate.`);
    }
    sumSats += sats;
  }
  if (sumSats !== toSats(params.totalAmount)) {
    throw new Error('totalAmount must equal the sum of the input amounts');
  }
  return {
    Function: VBTC_MULTI_WITHDRAWAL_FUNCTION,
    RequestorAddress: params.requestorAddress,
    BTCAddress: params.btcAddress,
    TotalAmount: sumSats / SATS_PER_VBTC,
    FeeRate: feeRate,
    Inputs: inputs.map((input) => ({ SCUID: input.scIdentifier, Amount: input.amount })),
  };
}

/**
 * Where one share stands, from its watched state (null: a vault the chain does
 * not watch, whose share is completed with completeWithdrawal as before).
 */
export function shareOutcome(watched: VbtcWatchedWithdrawal | null): VbtcWithdrawalShareOutcome {
  if (!watched) return 'legacy';
  if (watched.paid) return 'paid';
  if (watched.closed) {
    if (watched.state === 'Released') return 'released';
    if (watched.state === 'Cancelled') return 'cancelled';
    return 'closed';
  }
  if (watched.notMinedYet) return 'not_mined';
  if (watched.state === 'Waiting') return 'waiting';
  return 'being_paid';
}

/** Whether nothing more will happen to a share without the caller acting. */
export function isFinalShareOutcome(outcome: VbtcWithdrawalShareOutcome): boolean {
  return (
    outcome === 'paid' ||
    outcome === 'released' ||
    outcome === 'cancelled' ||
    outcome === 'closed' ||
    outcome === 'legacy'
  );
}
