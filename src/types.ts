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
  /** Reserve accounts only: a Register() has been sent from this address. */
  activated: boolean;
  /** Reserve accounts only: a Recover() has been sent, so the vault is retired. */
  deactivated?: boolean;
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
  /**
   * `addresses` minus each address's open withdrawal requests — what can
   * actually be sent. Absent from Spyglass deployments older than the
   * release that added it; fall back to `addresses`.
   */
  available_balances?: Record<string, number>;
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

export interface VbtcMultiTransferResult {
  transactionHash: string;
  /** The contracts drawn from and how much from each. */
  inputs: Array<{ scIdentifier: string; amount: number }>;
}

export interface VbtcWithdrawalResult {
  /** The Bitcoin transaction that paid it; empty while `paid` is false. */
  btcTransactionHash: string;
  /** The VFX completion transaction; empty while `paid` is false. */
  completionTransactionHash: string;
  withdrawalRequestHash: string;
  /**
   * Bitcoin has paid it. Always true for a vault the chain does not watch.
   * False for a watched vault's withdrawal the chain has taken but Bitcoin has
   * not paid yet: nothing needs to be done; follow it with getWithdrawalPin
   * or call completeWithdrawal again.
   */
  paid: boolean;
  /** The withdrawal's state when its vault is one the chain watches, else null. */
  watched: VbtcWatchedWithdrawal | null;
  /**
   * Set on a pending watched result when reads were still failing at the
   * deadline: why the last one failed. `watched` is then the last state read.
   */
  lastError?: string;
}

/** One Bitcoin transaction the chain has fixed for a watched withdrawal. */
export interface VbtcWatchedWithdrawalTransaction {
  txid: string;
  kind: 'Payment' | 'Release';
  feeRate: number | null;
  feeSats: number | null;
  superseded: boolean;
  dead: boolean;
  confirmed: boolean;
}

/**
 * Where a withdrawal from a vault the chain watches (Core 9.0 Bitcoin
 * attestation) stands. Nobody completes such a withdrawal by hand: the chain
 * pins its Bitcoin transaction and the vault's signers send it.
 */
export interface VbtcWatchedWithdrawal {
  /** `Completed`, `Awaiting_BTC_Confirmation`, `Awaiting_BTC_Transaction`, `Closed` or `Unknown`. */
  status: string;
  /** Bitcoin has paid it. */
  paid: boolean;
  /** The node has not mined the request yet (or the hash is wrong); ask again shortly. */
  notMinedYet: boolean;
  /** Nothing more will happen to it: paid, released or otherwise closed. */
  closed: boolean;
  message: string | null;
  /** The chain's state: `Waiting`, `Pinned`, `Settled`, `Released`, or another closed state. */
  state: string | null;
  summary: string | null;
  /** The fee rate (sat/vB) the newest live Bitcoin transaction pays. */
  feeRate: number | null;
  /** The lowest rate a fee raise or release may name: the node refuses one not above `feeRate`. */
  minimumNextFeeRate: number;
  canRaiseFee: boolean;
  canRelease: boolean;
  releasing: boolean;
  canCancel: boolean;
  /** The pinned Bitcoin transaction while it is not yet paid. */
  pinnedBtcTransactionHash: string | null;
  /** The Bitcoin transaction that paid it. */
  btcTransactionHash: string | null;
  completionTransactionHash: string | null;
  transactions: VbtcWatchedWithdrawalTransaction[];
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
  | 'completion_recorded'
  | 'watched_polling';

export interface VbtcProgressEvent {
  phase: VbtcProgressPhase;
  message: string;
  progress?: number;
  data?: unknown;
}

// Fungible tokens (VFX20)

/** A fungible token as Spyglass indexes it. */
export interface FungibleToken {
  sc_identifier: string;
  name: string;
  ticker: string;
  description: string | null;
  owner_address: string;
  can_mint: boolean;
  can_burn: boolean;
  can_vote: boolean;
  created_at: string;
  initial_supply: number;
  circulating_supply: number;
  decimal_places: number;
  image_url: string | null;
  is_paused: boolean;
  banned_addresses: string[];
  nsfw: boolean;
}

export interface FungibleTokenDetail {
  token: FungibleToken;
  /** Address → balance for every address that has ever held the token. */
  holders: Record<string, number>;
}

export interface FungibleTokenBalance {
  token: FungibleToken;
  balance: number;
}

export interface TokenVotingTopic {
  sc_identifier: string;
  token: FungibleToken;
  from_address: string;
  topic_id: string;
  name: string;
  description: string;
  vote_requirement: number;
  created_at: string;
  voting_ends_at: string;
  vote_data: unknown;
}

/**
 * The token's image. `url` must be publicly fetchable: Spyglass downloads it
 * and places it on the node as the contract's primary asset. `thumbnailBase64`
 * is the small inline image wallets display (the web wallet sends a 64px
 * PNG); when omitted the node uses its default token image.
 */
export interface TokenImage {
  url: string;
  /** File name to record for the asset. Defaults to the last path segment of `url`. */
  name?: string;
  /** File extension without the dot. Defaults to the extension of `name`. */
  extension?: string;
  /** Size in bytes, if known. */
  fileSize?: number;
  thumbnailBase64?: string;
}

export interface DeployTokenParams {
  name: string;
  /** Up to 20 characters; stored upper-cased. */
  ticker: string;
  /** Defaults to `name`. */
  description?: string;
  /** 1–18, default 8. */
  decimalPlaces?: number;
  /**
   * Whole-number supply minted to the deployer at creation. Must be 0 for a
   * mintable token — mint after deploy instead, as the wallets do.
   */
  initialSupply?: number;
  /** Owner may mint more after deploy (open-ended supply). Default false. */
  mintable?: boolean;
  /** Holders may burn from their own balance. Default false. */
  burnable?: boolean;
  /** Holders may vote on topics the owner creates. Default false. */
  voting?: boolean;
  image?: TokenImage;
}

export interface DeployTokenResult {
  transactionHash: string;
  /** The contract id every later token operation is addressed to. */
  scIdentifier: string;
}

// Reserve (Vault) accounts

/**
 * A reserve (vault) account: an `xRBX…` address whose outgoing sends wait
 * behind an unlock time and can be called back, plus the recovery key that
 * can sweep it. `restoreCode` is `base64("<privateKey>//<recoveryPrivateKey>")`,
 * the format the CLI and web wallet both restore from.
 */
export interface ReserveKeypair extends Keypair {
  recoveryPrivateKey: string;
  recoveryPublicKey: string;
  recoveryAddress: string;
  restoreCode: string;
}
