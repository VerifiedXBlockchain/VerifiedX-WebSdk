export interface PaginatedResponse<T> {
  count: number;
  page: number;
  num_pages: number;
  results: T[];
}

export interface Keypair {
  privateKey: string;
  publicKey: string;
  address: string;
}

export interface VfxAddress {
  address: string;
  balance: number;
  balanceTotal: number;
  balanceLocked: number;
  adnr: string | null;
  activated: boolean;
}

export interface Transaction {
  hash: string;
  height: number;
  type: number;
  type_label: string;
  to_address: string;
  from_address: string;
  total_amount: number;
  total_fee: number;
  data: string | null;
  date_crafted: string; // ISO string
  signature: string;
  nft: unknown;
  unlock_time: string | null;
  callback_details: unknown;
  recovery_details: unknown;
}

// vBTC V2

export interface VbtcV2Token {
  sc_identifier: string;
  name: string;
  description: string;
  owner_address: string;
  image_url: string;
  deposit_address: string;
  frost_group_public_key: string;
  required_threshold: number;
  proof_block_height: number;
  global_balance: number;
  total_received: number;
  total_sent: number;
  tx_count: number;
  is_pending_withdrawal: boolean;
  addresses: Record<string, number>;
  nft: unknown;
  withdrawal_requests: VbtcWithdrawalRequest[];
  created_at: string;
}

/**
 * Withdrawal states as served by Spyglass, which lowercases the node's
 * PascalCase names. This type previously admitted only 'requested' and
 * 'completed', so a cancelled withdrawal was a type error at the boundary.
 *
 * Spyglass derives these from transaction type as it indexes, not from a status
 * field on the node — the node never persists `Pending_BTC` at all. Both of the
 * added values are additive: deployments older than the release that widened
 * this set never emit them.
 *
 * Two caveats that matter when branching on these:
 *
 * - `pending_btc` is written when the FROST ceremony returns a signed Bitcoin
 *   transaction, which is marginally EARLIER than the broadcast — the ceremony
 *   runs in sign-only mode and the client broadcasts. It means "a spendable
 *   transaction exists", not "broadcast confirmed", and must not be rendered as
 *   the latter. It is deliberately the conservative direction for gating a
 *   retry.
 * - `pending_btc` only appears for ceremonies run THROUGH Spyglass (web wallet,
 *   Butterfly). A desktop wallet that drives a node directly never touches it,
 *   so those withdrawals stay 'requested' until completion lands. Absence of
 *   this status is not evidence that nothing was signed.
 * - `cancellation_requested` is a legitimate node state but is not yet reachable
 *   in Spyglass: a Type 29 currently writes 'cancelled' directly, without
 *   waiting on the 75% validator vote that actually decides it.
 */
export type VbtcWithdrawalStatus = 'requested' | 'pending_btc' | 'completed' | 'cancelled' | 'cancellation_requested';

export interface VbtcWithdrawalRequest {
  id: number;
  requestor_address: string;
  btc_address: string;
  amount: string;
  fee_rate: string;
  btc_transaction_hash: string;
  /**
   * See {@link VbtcWithdrawalStatus} for the per-value caveats. `pending_btc`
   * is the one to branch on: a signed Bitcoin transaction exists, so re-running
   * the withdrawal from here can pay the destination twice.
   */
  status: VbtcWithdrawalStatus;
  request_transaction_hash: string;
  completion_transaction_hash: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface VbtcTransfer {
  id: number;
  from_address: string;
  to_address: string;
  amount: string;
  transaction_hash: string;
  created_at: string;
}

export interface CreateVbtcResult {
  transactionHash: string;
  scIdentifier: string;
  depositAddress: string;
}

export interface VbtcTransferResult {
  transactionHash: string;
}

export interface VbtcWithdrawalResult {
  btcTransactionHash: string;
  completionTransactionHash: string;
  withdrawalRequestHash: string;
}

export interface VbtcCancelResult {
  transactionHash: string;
}

export type VbtcProgressPhase =
  | 'ceremony_started'
  | 'ceremony_polling'
  | 'ceremony_complete'
  | 'contract_preparing'
  | 'contract_sent'
  | 'withdraw_request_sent'
  | 'frost_preparing'
  | 'frost_polling'
  | 'frost_complete'
  | 'btc_broadcast'
  | 'completion_recorded';

export interface VbtcProgressEvent {
  phase: VbtcProgressPhase;
  message: string;
  progress?: number;
  data?: unknown;
}
