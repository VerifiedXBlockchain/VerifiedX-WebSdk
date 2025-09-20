import KeypairService from './keypair';
import TransactionService from './transaction';
import AccountService from './account';
import type {
  IBtcKeypair,
  IAccountInfo,
  ITransaction,
  ICreateTxResponse,
  IBroadcastTxResponse,
  IFeeRates
} from './types';

export default class BtcClient {
  private keypairService: KeypairService;
  private transactionService: TransactionService;
  private accountService: AccountService;
  private isTestnet: boolean;
  private dryRun: boolean;

  constructor(network: "mainnet" | "testnet" = "mainnet", dryRun = false) {
    this.isTestnet = network === "testnet";
    this.dryRun = dryRun;

    this.keypairService = new KeypairService(this.isTestnet);
    this.transactionService = new TransactionService(this.isTestnet);
    this.accountService = new AccountService(this.isTestnet);
  }

  // Keypair generation and management
  generatePrivateKey(): IBtcKeypair {
    return this.keypairService.keypairFromRandom();
  }

  generateMnemonic(): IBtcKeypair {
    return this.keypairService.keypairFromRandomMnemonic();
  }

  privateKeyFromMnemonic(mnemonic: string, index = 0): IBtcKeypair {
    return this.keypairService.keypairFromMnemonic(mnemonic, index);
  }

  publicFromPrivate(privateKey: string): IBtcKeypair {
    return this.keypairService.keypairFromPrivateKey(privateKey);
  }

  addressFromPrivate(privateKey: string): IBtcKeypair {
    return this.keypairService.keypairFromPrivateKey(privateKey);
  }

  addressFromWif(wif: string): IBtcKeypair {
    return this.keypairService.keypairFromWif(wif);
  }

  getSignature(message: string, privateKey: string): string {
    return this.keypairService.signMessageWithPrivateKey(privateKey, message);
  }

  getSignatureFromWif(message: string, wif: string): string {
    return this.keypairService.signMessage(wif, message);
  }

  // Account and address info
  async getAddressInfo(address: string, inSatoshis = true): Promise<IAccountInfo> {
    return this.accountService.addressInfo(address, inSatoshis);
  }

  async getTransactions(address: string, limit = 50, before: number | null = null): Promise<ITransaction[]> {
    return this.accountService.transactions(address, limit, before);
  }

  // Transaction operations
  async getFeeRates(): Promise<IFeeRates | null> {
    return this.transactionService.getFeeRates();
  }

  async createTransaction(senderWif: string, recipientAddress: string, amount: number, feeRate = 0): Promise<ICreateTxResponse> {
    if (this.dryRun) {
      return {
        success: true,
        result: "dry_run_transaction_hex",
        error: null
      };
    }
    return this.transactionService.createTransaction(senderWif, recipientAddress, amount, feeRate);
  }

  async broadcastTransaction(transactionHex: string): Promise<IBroadcastTxResponse> {
    if (this.dryRun) {
      return {
        success: true,
        result: "dry_run_transaction_id",
        error: null
      };
    }
    return this.transactionService.broadcastTransaction(transactionHex);
  }

  async sendBtc(senderWif: string, recipientAddress: string, amount: number, feeRate = 0): Promise<string | null> {
    const createResult = await this.createTransaction(senderWif, recipientAddress, amount, feeRate);

    if (!createResult.success || !createResult.result) {
      console.error('Failed to create transaction:', createResult.error);
      return null;
    }

    const broadcastResult = await this.broadcastTransaction(createResult.result);

    if (!broadcastResult.success || !broadcastResult.result) {
      console.error('Failed to broadcast transaction:', broadcastResult.error);
      return null;
    }

    return broadcastResult.result;
  }

  // Utility functions
  async getRawTransaction(txId: string): Promise<Buffer> {
    return this.transactionService.getRawTx(txId);
  }

  // Additional convenience methods
  generateEmailKeypair(email: string, password: string, index = 0): IBtcKeypair {
    return this.keypairService.keypairFromEmailPassword(email, password, index);
  }
}