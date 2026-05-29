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
