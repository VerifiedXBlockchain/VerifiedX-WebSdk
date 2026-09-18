/**
 * Multi-contract vBTC transfers: one transaction that draws from several
 * vBTC contracts the sender holds balance on. Mirrors the web wallet's
 * allocator (vbtc_multi_allocator.dart), which mirrors the CLI's.
 */

/** The node refuses a multi-contract transfer with more inputs than this. */
export const VBTC_MULTI_MAX_INPUTS = 25;
export const VBTC_MULTI_TRANSFER_FUNCTION = 'TransferVBTCMultiV2()';

const SATS_PER_VBTC = 100_000_000;

function toSats(amount: number): number {
  return Math.round(amount * SATS_PER_VBTC);
}

function fromSats(sats: number): number {
  return sats / SATS_PER_VBTC;
}

/** One contract's share of a multi-contract transfer. */
export interface VbtcAllocationInput {
  scIdentifier: string;
  amount: number;
}

export type VbtcAllocationFailure = 'insufficientBalance' | 'tooManyInputs';

export interface VbtcAllocation {
  inputs: VbtcAllocationInput[];
  /** Combined spendable balance across every candidate, after rounding. */
  available: number;
  failure?: VbtcAllocationFailure;
}

/**
 * Split `total` across `balances` (contract id → spendable vBTC) the way the
 * CLI's allocator does: largest balance first, ties broken by contract id,
 * greedy until covered. Works in whole satoshis so the inputs sum to the
 * total exactly — the node rejects any drift between TotalAmount and the
 * inputs.
 */
export function allocateVbtcInputs(balances: Record<string, number>, total: number): VbtcAllocation {
  const candidates = Object.entries(balances)
    .map(([scIdentifier, balance]) => ({ scIdentifier, sats: toSats(balance) }))
    .filter((c) => c.sats > 0)
    .sort(
      (a, b) => b.sats - a.sats || (a.scIdentifier < b.scIdentifier ? -1 : a.scIdentifier > b.scIdentifier ? 1 : 0),
    );

  const available = fromSats(candidates.reduce((sum, c) => sum + c.sats, 0));

  let remaining = toSats(total);
  const inputs: VbtcAllocationInput[] = [];
  for (const candidate of candidates) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, candidate.sats);
    inputs.push({ scIdentifier: candidate.scIdentifier, amount: fromSats(take) });
    remaining -= take;
  }

  if (remaining > 0) {
    return { inputs: [], available, failure: 'insufficientBalance' };
  }
  if (inputs.length > VBTC_MULTI_MAX_INPUTS) {
    return { inputs: [], available, failure: 'tooManyInputs' };
  }
  return { inputs, available };
}

/**
 * The Data payload for a TransferVBTCMultiV2() transaction. Exactly these
 * five keys: the node rejects a top-level ContractUID. FromAddress and
 * ToAddress must match the transaction's own; the node checks both.
 */
export function vbtcMultiTransferData(params: {
  fromAddress: string;
  toAddress: string;
  totalAmount: number;
  inputs: VbtcAllocationInput[];
}): Record<string, unknown> {
  if (params.inputs.length === 0) {
    throw new Error('A multi-contract vBTC transfer needs at least one input');
  }
  if (params.inputs.length > VBTC_MULTI_MAX_INPUTS) {
    throw new Error(`A multi-contract vBTC transfer may draw from at most ${VBTC_MULTI_MAX_INPUTS} contracts`);
  }
  const ids = new Set(params.inputs.map((i) => i.scIdentifier));
  if (ids.size !== params.inputs.length) {
    throw new Error('Multi-contract vBTC transfer inputs must reference distinct contracts');
  }
  let sumSats = 0;
  for (const input of params.inputs) {
    if (!input.scIdentifier) {
      throw new Error('Every multi-contract vBTC transfer input needs a scIdentifier');
    }
    if (!(input.amount > 0)) {
      throw new Error('Every multi-contract vBTC transfer input amount must be greater than zero');
    }
    const sats = toSats(input.amount);
    if (fromSats(sats) !== input.amount) {
      throw new Error('Multi-contract vBTC transfer input amounts cannot have more than 8 decimal places');
    }
    sumSats += sats;
  }
  if (sumSats !== toSats(params.totalAmount)) {
    throw new Error('totalAmount must equal the sum of the input amounts');
  }
  return {
    Function: VBTC_MULTI_TRANSFER_FUNCTION,
    FromAddress: params.fromAddress,
    ToAddress: params.toAddress,
    TotalAmount: fromSats(sumSats),
    Inputs: params.inputs.map((input) => ({ SCUID: input.scIdentifier, Amount: input.amount })),
  };
}
