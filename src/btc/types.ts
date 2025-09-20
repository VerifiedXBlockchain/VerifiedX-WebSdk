import type { Network } from 'bitcoinjs-lib';

// Core interfaces for BTC functionality
export interface IBtcKeypair {
  address: string | undefined;
  addresses: IBtcAddresses;
  wif: string;
  privateKey: string | undefined;
  publicKey: string;
  mnemonic?: string;
}

export interface IBtcAddresses {
  p2pkh: string | undefined;    // Legacy (P2PKH)
  p2sh: string | undefined;     // Nested Segwit (P2SH-P2WPKH)
  bech32: string | undefined;   // Native Segwit (P2WPKH)
  bech32m: string | undefined;  // Taproot (P2TR)
}

export interface IAccountInfo {
  totalRecieved: number;
  totalSent: number;
  balance: number;
  txCount: number;
}

export interface ITransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: ITransactionInput[];
  vout: ITransactionOutput[];
  size: number;
  weight: number;
  fee: number;
  status: ITransactionStatus;
}

export interface ITransactionInput {
  txid: string;
  vout: number;
  prevout: ITransactionOutput;
  scriptsig: string;
  scriptsig_asm: string;
  witness: string[];
  is_coinbase: boolean;
  sequence: number;
}

export interface ITransactionOutput {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface ITransactionStatus {
  confirmed: boolean;
  block_height: number;
  block_hash: string;
  block_time: number;
}

export interface ICreateTxResponse {
  success: boolean;
  result: string | null;
  error: string | null;
}

export interface IBroadcastTxResponse {
  success: boolean;
  result: string | null;
  error: string | null;
}

export interface IFeeRates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export interface IUTXO {
  txid: string;
  vout: number;
  status: ITransactionStatus;
  value: number;
}

// Utility function types
export interface IUtilityFunctions {
  publicKeyToAddress: (publicKey: Buffer, network: Network) => IBtcAddresses;
  wifToPrivateKey: (wif: string, network: Network) => Buffer | undefined;
  seedToPrivateKey: (seed: string, index?: number, network?: Network) => Buffer | undefined;
  hashSeed: (seed: string) => string;
}

// Service class interfaces
export interface IKeypairService {
  network: Network;
  keypairFromRandom(): IBtcKeypair;
  keypairFromWif(wif: string): IBtcKeypair;
  keypairFromPrivateKey(privateKeyString: string): IBtcKeypair;
  keypairFromMnemonic(mnemonic: string, index?: number): IBtcKeypair;
  keypairFromRandomMnemonic(): IBtcKeypair;
  keypairFromEmailPassword(email: string, password: string, index?: number): IBtcKeypair;
  signMessage(wif: string, message: string): string;
  signMessageWithPrivateKey(privateKeyHex: string, message: string): string;
}

export interface ITransactionService {
  network: Network;
  apiBaseUrl: string;
  getFeeRates(): Promise<IFeeRates | null>;
  getRawTx(txId: string): Promise<Buffer>;
  createTransaction(senderWif: string, recipientAddress: string, amount: number, feeRate?: number): Promise<ICreateTxResponse>;
  broadcastTransaction(transactionHex: string): Promise<IBroadcastTxResponse>;
}

export interface IAccountService {
  network: Network;
  addressInfo(address: string, inSatoshis?: boolean): Promise<IAccountInfo>;
  transactions(address: string, limit?: number, before?: number | null): Promise<ITransaction[]>;
}

// Main BTC Client interface
export interface IBtcClient {
  new(network: "mainnet" | "testnet", dryRun?: boolean): {
    // Keypair generation and management
    generatePrivateKey: () => IBtcKeypair
    generateMnemonic: (words?: 12 | 24) => IBtcKeypair
    privateKeyFromMnemonic: (mnemonic: string, index?: number) => IBtcKeypair
    publicFromPrivate: (privateKey: string) => IBtcKeypair
    addressFromPrivate: (privateKey: string) => IBtcKeypair
    addressFromWif: (wif: string) => IBtcKeypair
    getSignature: (message: string, privateKey: string) => string
    getSignatureFromWif: (message: string, wif: string) => string

    // Account and address info
    getAddressInfo: (address: string, inSatoshis?: boolean) => Promise<IAccountInfo>
    getTransactions: (address: string, limit?: number, before?: number | null) => Promise<ITransaction[]>

    // Transaction operations
    getFeeRates: () => Promise<IFeeRates | null>
    createTransaction: (senderWif: string, recipientAddress: string, amount: number, feeRate?: number) => Promise<ICreateTxResponse>
    broadcastTransaction: (transactionHex: string) => Promise<IBroadcastTxResponse>
    sendBtc: (senderWif: string, recipientAddress: string, amount: number, feeRate?: number) => Promise<string | null>

    // Utility functions
    getRawTransaction: (txId: string) => Promise<Buffer>
  }
}

// Global window interface for browser usage

// Export all types
export type {
  IBtcKeypair as BtcKeypair,
  IBtcAddresses as BtcAddresses,
  IAccountInfo as AccountInfo,
  ITransaction as Transaction,
  ITransactionInput as TransactionInput,
  ITransactionOutput as TransactionOutput,
  ITransactionStatus as TransactionStatus,
  ICreateTxResponse as CreateTxResponse,
  IBroadcastTxResponse as BroadcastTxResponse,
  IFeeRates as FeeRates,
  IUTXO as UTXO,
  IKeypairService as KeypairService,
  ITransactionService as TransactionService,
  IAccountService as AccountService,
  IBtcClient as BtcClient
};