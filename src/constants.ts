export enum TxType {
  RbxTransfer = 0,
  Node = 1,
  NftMint = 2,
  NftTx = 3,
  NftBurn = 4,
  NftSale = 5,
  Adnr = 6,
  DstShop = 7,
  VoteTopic = 8,
  Vote = 9,
  Reserve = 10,
  TokenTx = 15,
  TokenDeploy = 17,
  VbtcV2ContractCreate = 25,
  VbtcV2Transfer = 26,
  VbtcV2WithdrawalRequest = 27,
  VbtcV2WithdrawalComplete = 28,
  VbtcV2WithdrawalCancel = 29,
}

export enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
}

export const DOMAIN_PURCHASE_COST = 5.0;
export const DOMAIN_TRANSFER_COST = 5.0;
export const DOMAIN_DELETE_COST = 5.0;

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
