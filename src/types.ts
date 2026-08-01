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
 * PascalCase names (VbtcV2WithdrawalRequest.Status). This type previously
 * admitted only 'requested' and 'completed', so a cancelled withdrawal was a
 * type error at the boundary.
 *
 * 'pending_btc' and 'cancellation_requested' are served by Spyglass from the
 * release that widened its status set to match the node's six; older
 * deployments never emit them, so treat them as additive rather than assuming
 * every backend produces them.
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
   * Mirrors the node's withdrawal states (VBTCContractV2.cs). `Pending_BTC`
   * matters most: the Bitcoin transaction is broadcast but the on-chain
   * completion is not yet recorded, which is the one state where re-running a
   * withdrawal can pay the destination twice.
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
