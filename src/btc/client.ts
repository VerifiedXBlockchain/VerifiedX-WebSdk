import KeypairService from './keypair';
import TransactionService from './transaction';
import AccountService from './account';
import type {
  IBtcKeypair,
  IAccountInfo,
  ITransaction,
  ICreateTxResponse,
  IBroadcastTxResponse,
  IBroadcastCheck,
  IFeeRates,
} from './types';

export interface BtcClientOptions {
  dryRun?: boolean;
  /**
   * Override the mempool.space-style API origin (including /api), e.g.
   * 'https://mempool.space/testnet4/api' or a self-hosted mempool instance.
   */
  apiBaseUrl?: string;
}

export default class BtcClient {
  private keypairService: KeypairService;
  private transactionService: TransactionService;
  private accountService: AccountService;
  private isTestnet: boolean;
  private dryRun: boolean;

  /**
   * @param network 'mainnet' | 'testnet'
   * @param dryRunOrOptions boolean dryRun (historical signature) or a
   *   BtcClientOptions object: new BtcClient('testnet', { apiBaseUrl: '...' })
   */
  constructor(network: 'mainnet' | 'testnet' = 'mainnet', dryRunOrOptions: boolean | BtcClientOptions = false) {
    this.isTestnet = network === 'testnet';

    const options: BtcClientOptions =
      typeof dryRunOrOptions === 'boolean' ? { dryRun: dryRunOrOptions } : dryRunOrOptions;
    this.dryRun = options.dryRun ?? false;

    this.keypairService = new KeypairService(this.isTestnet);
    this.transactionService = new TransactionService(this.isTestnet, options.apiBaseUrl);
    this.accountService = new AccountService(this.isTestnet, options.apiBaseUrl);
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

  async createTransaction(
    senderWif: string,
    recipientAddress: string,
    amount: number,
    feeRate = 0,
  ): Promise<ICreateTxResponse> {
    if (this.dryRun) {
      return {
        success: true,
        result: 'dry_run_transaction_hex',
        error: null,
      };
    }
    return this.transactionService.createTransaction(senderWif, recipientAddress, amount, feeRate);
  }

  /**
   * Broadcast a signed transaction. Safe to repeat with the same hex.
   * `success: false` means the network did not take it; an unknown outcome
   * throws BtcBroadcastUnknownError.
   */
  async broadcastTransaction(transactionHex: string): Promise<IBroadcastTxResponse> {
    if (this.dryRun) {
      return {
        success: true,
        result: 'dry_run_transaction_id',
        error: null,
      };
    }
    return this.transactionService.broadcastTransaction(transactionHex);
  }

  /**
   * Build, sign and broadcast a payment of `amount` BTC (not satoshis).
   *
   * Returns the txid, or null when nothing was sent (the transaction could
   * not be built, or the network refused it). Throws BtcBroadcastUnknownError
   * when the broadcast request went out but no definite answer came back:
   * the payment may be on the network. Do not call sendBtc again for it;
   * resolve it with checkBroadcast and broadcastTransaction(error.signedTxHex).
   */
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

  /**
   * Where a signed transaction stands on the network: `found`, `conflicted`
   * (an input is spent by another transaction, so it can never confirm),
   * `absent` (not seen, inputs unspent: re-broadcast the same hex) or
   * `unresolved` (an input is spent by an unreported transaction). Throws
   * when the API cannot answer.
   */
  async checkBroadcast(signedTxHex: string): Promise<IBroadcastCheck> {
    return this.transactionService.checkBroadcast(signedTxHex);
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
