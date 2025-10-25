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

export interface VbtcWithdrawalResult {
  txHash: string;
  uniqueId: string;
  scId: string;
}

export interface VbtcWithdrawRequest {
  SmartContractUID: string;
  Amount: number;
  VFXAddress: string;
  BTCToAddress: string;
  Timestamp: number;
  UniqueId: string;
  VFXSignature: string;
  ChosenFeeRate: number;
  IsTest: boolean;
  [key: string]: unknown;
}
