import type { Network } from 'bitcoinjs-lib';
import type { BtcSigner } from './signer';

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
  p2pkh: string | undefined; // Legacy (P2PKH)
  p2sh: string | undefined; // Nested Segwit (P2SH-P2WPKH)
  bech32: string | undefined; // Native Segwit (P2WPKH)
  bech32m: string | undefined; // Taproot (P2TR)
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

/** Where a signed transaction stands on the network (see BtcClient.checkBroadcast). */
export type IBroadcastCheck =
  | { state: 'found'; txid: string; confirmed: boolean }
  | { state: 'conflicted'; txid: string; conflictingTxid: string }
  | { state: 'absent'; txid: string }
  | { state: 'unresolved'; txid: string };

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
  createTransaction(
    senderWif: string,
    recipientAddress: string,
    amount: number,
    feeRate?: number,
  ): Promise<ICreateTxResponse>;
  broadcastTransaction(transactionHex: string): Promise<IBroadcastTxResponse>;
  checkBroadcast(signedTxHex: string): Promise<IBroadcastCheck>;
}

export interface IAccountService {
  network: Network;
  addressInfo(address: string, inSatoshis?: boolean): Promise<IAccountInfo>;
  transactions(address: string, limit?: number, before?: string | null): Promise<ITransaction[]>;
}

export interface BtcClientOptions {
  dryRun?: boolean;
  /**
   * Override the mempool.space-style (Esplora) API origin, including /api,
   * e.g. a self-hosted mempool instance. Defaults: mainnet
   * 'https://mempool.space/api', testnet (the VerifiedX signet)
   * 'https://signet.verifiedx.io/api'.
   */
  apiBaseUrl?: string;
}

// Main BTC Client interface: the shape of the BtcClient class.
export interface IBtcClient {
  new (network?: 'mainnet' | 'testnet', dryRunOrOptions?: boolean | BtcClientOptions): {
    // Keypair generation and management
    generatePrivateKey: () => IBtcKeypair;
    generateMnemonic: () => IBtcKeypair;
    privateKeyFromMnemonic: (mnemonic: string, index?: number) => IBtcKeypair;
    publicFromPrivate: (privateKey: string) => IBtcKeypair;
    addressFromPrivate: (privateKey: string) => IBtcKeypair;
    addressFromWif: (wif: string) => IBtcKeypair;
    getSignature: (message: string, privateKey: string) => string;
    getSignatureFromWif: (message: string, wif: string) => string;
    getSignatureWithSigner: (
      message: string,
      signer: BtcSigner,
      purpose?: 'btc-name-claim' | 'btc-name-transfer-acceptance' | 'message',
    ) => Promise<string>;

    // Account and address info
    getAddressInfo: (address: string, inSatoshis?: boolean) => Promise<IAccountInfo>;
    getTransactions: (address: string, limit?: number, before?: string | null) => Promise<ITransaction[]>;

    // Transaction operations
    getFeeRates: () => Promise<IFeeRates | null>;
    createTransaction: (
      sender: string | BtcSigner,
      recipientAddress: string,
      amount: number,
      feeRate?: number,
    ) => Promise<ICreateTxResponse>;
    broadcastTransaction: (transactionHex: string) => Promise<IBroadcastTxResponse>;
    sendBtc: (
      sender: string | BtcSigner,
      recipientAddress: string,
      amount: number,
      feeRate?: number,
    ) => Promise<string | null>;
    checkBroadcast: (signedTxHex: string) => Promise<IBroadcastCheck>;

    // Utility functions
    getRawTransaction: (txId: string) => Promise<Buffer>;
    generateEmailKeypair: (email: string, password: string, index?: number) => IBtcKeypair;
  };
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
  IBroadcastCheck as BroadcastCheck,
  IFeeRates as FeeRates,
  IUTXO as UTXO,
  IKeypairService as KeypairService,
  ITransactionService as TransactionService,
  IAccountService as AccountService,
  IBtcClient as BtcClient,
};
