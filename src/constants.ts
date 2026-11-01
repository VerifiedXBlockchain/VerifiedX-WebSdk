/**
 * Core's TransactionType (Models/Transaction.cs, 9.0.1), values 0 to 46.
 * Member names are the SDK's; Core's name is in each comment where it differs.
 */
export enum TxType {
  /** TX */
  RbxTransfer = 0,
  Node = 1,
  NftMint = 2,
  NftTx = 3,
  NftBurn = 4,
  NftSale = 5,
  Adnr = 6,
  /** DSTR: DST shop registration */
  DstShop = 7,
  VoteTopic = 8,
  Vote = 9,
  Reserve = 10,
  /** SC_MINT: standard smart contract mint */
  ScMint = 11,
  /** SC_TX */
  ScTx = 12,
  /** SC_BURN */
  ScBurn = 13,
  /** FTKN_MINT: fungible token mint */
  FungibleTokenMint = 14,
  /** FTKN_TX: fungible token transfer and operations */
  TokenTx = 15,
  /** FTKN_BURN */
  FungibleTokenBurn = 16,
  /** TKNZ_MINT in Core; the live fungible-token deploy type */
  TokenDeploy = 17,
  /** TKNZ_TX */
  TokenizationTx = 18,
  /** TKNZ_BURN */
  TokenizationBurn = 19,
  /** TKNZ_WD_ARB */
  TokenizationWithdrawalArbiter = 20,
  /** TKNZ_WD_OWNER */
  TokenizationWithdrawalOwner = 21,
  VbtcV2ValidatorRegister = 22,
  VbtcV2ValidatorHeartbeat = 23,
  VbtcV2ValidatorExit = 24,
  VbtcV2ContractCreate = 25,
  VbtcV2Transfer = 26,
  VbtcV2WithdrawalRequest = 27,
  VbtcV2WithdrawalComplete = 28,
  VbtcV2WithdrawalCancel = 29,
  /** Validator vote on a withdrawal cancellation */
  VbtcV2WithdrawalVote = 30,
  VfxShield = 31,
  VfxUnshield = 32,
  VfxPrivateTransfer = 33,
  VbtcV2Shield = 34,
  VbtcV2Unshield = 35,
  VbtcV2PrivateTransfer = 36,
  /** Lock vBTC for bridging to Base */
  VbtcV2BridgeLock = 37,
  /** Unlock vBTC after a burn on Base (single lock) */
  VbtcV2BridgeUnlock = 38,
  /** Credit vBTC from several locks to one VFX address */
  VbtcV2BridgePoolUnlock = 39,
  /** Record a Base burnForBTCExit as a Bitcoin withdrawal intent */
  VbtcV2BridgeExitToBtc = 40,
  VbtcV2BridgeExitToBtcComplete = 41,
  VbtcV2BridgeExitToBtcFail = 42,
  /** Sender-less (BTC_Attestation): Bitcoin headers and vault transactions of one Bitcoin block */
  VbtcV2BtcReport = 43,
  /** Raises the Bitcoin fee of, or releases, a pinned withdrawal on a watched vault. */
  VbtcV2CoinPin = 44,
  /** Sender-less (BTC_Attestation): rewinds reported events after a Bitcoin reorg */
  VbtcV2BtcReorg = 45,
  /** Sender-less: replaces a vault's key with one made by the current validators */
  VbtcV2VaultRekey = 46,
}

export enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
}

export const DOMAIN_PURCHASE_COST = 5.0;
/** Longest .vfx name before the suffix (Core's Globals.ADNRLimit). */
export const ADNR_NAME_MAX_LENGTH = 65;
export const DOMAIN_TRANSFER_COST = 5.0;
export const DOMAIN_DELETE_COST = 5.0;

/**
 * Core's BtcNameSignerOwnsAddressHeight (9.0.1), per network. From this block
 * a .btc name create is signed by the Bitcoin address's own key over
 * `<unix seconds>:<VFX owner>:<name>.btc`; below it Core accepts only a bare
 * timestamp. Same values as the GUI's BTC_NAME_SIGNED_MESSAGE_HEIGHT_*.
 */
export const BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET = 7400;
export const BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET = 7_575_250;

export function btcNameSignedMessageHeight(network: Network): number {
  return network === Network.Testnet ? BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET : BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET;
}

/** Whether the block after `latestBlockHeight` requires the signed BTC name message. */
export function btcNameSignedMessagesActive(network: Network, latestBlockHeight: number): boolean {
  return latestBlockHeight + 1 >= btcNameSignedMessageHeight(network);
}

export const VFX_API_BASE_URL_TESTNET = 'https://data-testnet.verifiedx.io/api';
export const VFX_API_BASE_URL_MAINNET = 'https://data.verifiedx.io/api';

// Fungible tokens (VFX20)

/** Target address for token operations that have no counterparty (mint, burn, pause, ban, vote topics). */
export const TOKEN_BASE_ADDRESS = 'Token_Base';
/** Compiler FeatureName for the fungible-token feature of a smart contract. */
export const TOKEN_FEATURE_ID = 13;
export const TOKEN_MIN_DECIMAL_PLACES = 1;
export const TOKEN_MAX_DECIMAL_PLACES = 18;
export const TOKEN_DEFAULT_DECIMAL_PLACES = 8;
export const TOKEN_TICKER_MAX_LENGTH = 20;
/** Placeholder the compiler expects for a not-yet-assigned asset / contract id. */
export const SMART_CONTRACT_PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';
/** Asset location that tells the node a contract carries no primary asset file. */
export const SMART_CONTRACT_DEFAULT_ASSET_LOCATION = 'default';

// Reserve (Vault) accounts

/** Target address for reserve-account transactions (register, call back, recover). */
export const RESERVE_BASE_ADDRESS = 'Reserve_Base';
/** Every reserve address starts with this; the derivation retries until one does. */
export const RESERVE_ADDRESS_PREFIX = 'xRBX';
/** VFX sent with the Register() transaction to activate a reserve account. */
export const RESERVE_ACTIVATION_COST = 4;
/** A reserve account must keep at least this much VFX after any send. */
export const RESERVE_MIN_REMAINING_BALANCE = 0.5;
/** Minimum delay on a send from a reserve account, as the wallets enforce it. */
export const RESERVE_MIN_UNLOCK_HOURS = 24;
