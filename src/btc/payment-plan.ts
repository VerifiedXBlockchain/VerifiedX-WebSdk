import type { BtcSpendType } from './address-types';

// The size and fee arithmetic of a Bitcoin payment, shared by the transaction
// that is built (TransactionService.buildPayment) and the quote of it
// (TransactionService.quoteTransaction), so a quote is exactly what is charged.

const P2WPKH_INPUT_SIZE = 68;
const P2WPKH_OUTPUT_SIZE = 31;

/** Virtual size of one input and of one change output, per spend type (key-path Taproot). */
const SPEND_SIZES: Record<Exclude<BtcSpendType, 'p2wpkh'>, { input: number; output: number }> = {
  'p2sh-p2wpkh': { input: 91, output: 32 },
  p2pkh: { input: 148, output: 34 },
  p2tr: { input: 58, output: 43 },
  'p2tr-bip86': { input: 58, output: 43 },
};

const TX_OVERHEAD_SIZE = 10;

// Conservative dust limit: change below this is folded into the fee rather
// than creating an output relay policy may reject.
export const DUST_THRESHOLD = 546;

/** Virtual size one input of `spendType` adds. */
export function inputVsize(spendType: BtcSpendType): number {
  return spendType === 'p2wpkh' ? P2WPKH_INPUT_SIZE : SPEND_SIZES[spendType].input;
}

export type BtcPaymentPlan =
  | {
      sufficient: true;
      /** Whether a change output back to the sender is added (change at or above dust). */
      hasChange: boolean;
      /** The change output's value; 0 when there is none. */
      changeSats: number;
      /** What the transaction pays: inputs minus outputs, including a sub-dust remainder. */
      feeSats: number;
      /** Estimated virtual size of the transaction, with or without its change output. */
      vsize: number;
    }
  | {
      sufficient: false;
      hasChange: false;
      changeSats: 0;
      /** The least fee the payment would need (no change output). */
      feeSats: number;
      vsize: number;
      /** Amount plus that fee: what the inputs would have to cover. */
      requiredSats: number;
    };

/**
 * The fee, size and change of paying `amountSats` from `inputCount` inputs
 * totalling `inputSum` sats. The fee is estimated for the shape actually
 * produced: with a change output when the change is worth keeping, without one
 * when the remainder is dust (which then goes to the fee). P2WPKH keeps the
 * historical estimate exactly; the other types count the recipient's real
 * output script and their own change output.
 */
export function planBtcPayment(params: {
  spendType: BtcSpendType;
  inputCount: number;
  inputSum: number;
  amountSats: number;
  feeRate: number;
  /** Length of the recipient's output script (bytes); ignored for P2WPKH. */
  recipientScriptLength: number;
}): BtcPaymentPlan {
  const { spendType, inputCount, inputSum, amountSats, feeRate } = params;
  const inputSize = inputCount * inputVsize(spendType);
  const recipientOutputSize = spendType === 'p2wpkh' ? P2WPKH_OUTPUT_SIZE : 9 + params.recipientScriptLength;
  const changeOutputSize = spendType === 'p2wpkh' ? P2WPKH_OUTPUT_SIZE : SPEND_SIZES[spendType].output;
  const vsizeWithChange = inputSize + recipientOutputSize + changeOutputSize + TX_OVERHEAD_SIZE;
  const vsizeWithoutChange = inputSize + recipientOutputSize + TX_OVERHEAD_SIZE;
  const feeWithChange = Math.ceil(vsizeWithChange * feeRate);
  const feeWithoutChange = Math.ceil(vsizeWithoutChange * feeRate);

  const change = inputSum - amountSats - feeWithChange;
  if (change >= DUST_THRESHOLD) {
    return { sufficient: true, hasChange: true, changeSats: change, feeSats: feeWithChange, vsize: vsizeWithChange };
  }
  if (inputSum - amountSats - feeWithoutChange < 0) {
    return {
      sufficient: false,
      hasChange: false,
      changeSats: 0,
      feeSats: feeWithoutChange,
      vsize: vsizeWithoutChange,
      requiredSats: amountSats + feeWithoutChange,
    };
  }
  // A sub-dust remainder is left to the miner as fee.
  return {
    sufficient: true,
    hasChange: false,
    changeSats: 0,
    feeSats: inputSum - amountSats,
    vsize: vsizeWithoutChange,
  };
}
