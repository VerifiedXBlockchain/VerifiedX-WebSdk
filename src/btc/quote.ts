import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinNetworkInput, BtcSpendType, resolveBitcoinNetwork } from './address-types';
import { planBtcPayment } from './payment-plan';
import type { IBtcPaymentQuote, IBtcQuoteUtxo } from './types';

// The quote of a Bitcoin payment from coins the caller already has: the same
// sizing (recipientScriptLength) and arithmetic (planBtcPayment) the send
// uses, with no network I/O. TransactionService.quoteTransaction and
// buildPayment go through the same two functions.

/** A P2WPKH output script (OP_0, push 20, 20-byte hash): how a missing recipient is sized. */
const P2WPKH_SCRIPT_LENGTH = 22;

/**
 * Output script length the size estimate counts for the recipient. P2WPKH
 * senders use a fixed recipient size (planBtcPayment ignores the length), so
 * this is 0 for them. The recipient is checked for every spend type: an
 * address that is invalid, or for another network, throws rather than
 * getting a quote the send would then refuse.
 */
export function recipientScriptLength(
  spendType: BtcSpendType,
  recipientAddress: string,
  network: bitcoin.Network,
): number {
  const script = bitcoin.address.toOutputScript(recipientAddress, network);
  return spendType === 'p2wpkh' ? 0 : script.length;
}

/**
 * What paying `amountSats` from these coins would cost, worked out
 * synchronously from UTXOs the caller already holds (for example on every
 * keystroke of a send form). Every UTXO is spent, as the send does, through
 * the same sizes and arithmetic, so a send from the same UTXOs at the same
 * fee rate pays exactly `feeSats`.
 *
 * - `recipientAddress` may be null or omitted before one is entered: the
 *   recipient output is then sized as a P2WPKH output (31 vB), which is
 *   also what a P2WPKH sender counts for any recipient. A recipient that is
 *   given must be a valid address on `network`, or this throws.
 * - `amountSats` may be 0, to show the fee before an amount is entered; the
 *   send itself refuses 0.
 * - `feeRate` must be above 0: there is no economy-rate lookup here.
 * - A UTXO counts as unconfirmed unless its Esplora `status.confirmed` is true.
 */
export function quoteBtcPayment(params: {
  utxos: ReadonlyArray<IBtcQuoteUtxo>;
  spendType: BtcSpendType;
  recipientAddress?: string | null;
  amountSats: number;
  feeRate: number;
  network: BitcoinNetworkInput;
}): IBtcPaymentQuote {
  const { utxos, spendType, amountSats, feeRate } = params;
  const recipientAddress = params.recipientAddress ?? null;
  if (!Number.isSafeInteger(amountSats) || amountSats < 0) {
    throw new Error(`quoteBtcPayment: amountSats must be a whole number of satoshis, 0 or more, got ${amountSats}`);
  }
  if (!Number.isFinite(feeRate) || feeRate <= 0) {
    throw new Error(`quoteBtcPayment: feeRate must be above 0 sat/vB, got ${feeRate}`);
  }
  const network = resolveBitcoinNetwork(params.network);
  const scriptLength =
    recipientAddress === null
      ? spendType === 'p2wpkh'
        ? 0
        : P2WPKH_SCRIPT_LENGTH
      : recipientScriptLength(spendType, recipientAddress, network);
  const inputTotalSats = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const plan = planBtcPayment({
    spendType,
    inputCount: utxos.length,
    inputSum: inputTotalSats,
    amountSats,
    feeRate,
    recipientScriptLength: scriptLength,
  });
  return {
    addressType: spendType,
    recipientAddress,
    amountSats,
    feeRate,
    feeSats: plan.feeSats,
    vsize: plan.vsize,
    inputCount: utxos.length,
    unconfirmedInputs: utxos.filter((utxo) => utxo.status?.confirmed !== true).length,
    inputTotalSats,
    changeSats: plan.changeSats,
    hasChange: plan.hasChange,
    sufficient: plan.sufficient,
    requiredSats: plan.sufficient ? amountSats + plan.feeSats : plan.requiredSats,
  };
}
