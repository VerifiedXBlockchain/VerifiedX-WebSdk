import KeypairService from './keypair';
import TransactionService from './transaction';
import AccountService from './account';
import { BtcSigner, assertBtcSignerAddress, isBtcSigner, signBtcMessage } from './signer';
import { newFlowId } from '../signer';
import { BtcSpendType, addressForSpendType } from './address-types';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import type {
  IBtcKeypair,
  IAccountInfo,
  ITransaction,
  ICreateTxResponse,
  IBroadcastTxResponse,
  IBroadcastCheck,
  IFeeRates,
  IBtcQuoteUtxo,
  IBtcSendQuote,
  BtcClientOptions,
} from './types';

export type { BtcClientOptions };

const ECPair = ECPairFactory(ecc);

/** The spend type an address's output script is, or null when the text is not an address on `network`. */
function spendTypeOfAddress(text: string, network: bitcoin.Network): BtcSpendType | null {
  let script: Buffer;
  try {
    script = bitcoin.address.toOutputScript(text, network);
  } catch {
    return null;
  }
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return 'p2wpkh';
  if (script.length === 23 && script[0] === 0xa9) return 'p2sh-p2wpkh';
  if (script.length === 25 && script[0] === 0x76) return 'p2pkh';
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return 'p2tr';
  throw new Error(`quoteTransaction: ${text} is not an address type the SDK spends from`);
}

/** Spend types that share an output script form (the two Taproot types). */
const spendFamily = (type: BtcSpendType): string => (type === 'p2tr-bip86' ? 'p2tr' : type);

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

  /**
   * `getSignature` with a BtcSigner: the same `<DER hex>.<public key hex>`
   * format, signed by the signer's `signDigest` over a `btc-message` request.
   */
  async getSignatureWithSigner(
    message: string,
    signer: BtcSigner,
    purpose: 'btc-name-claim' | 'btc-name-transfer-acceptance' | 'message' = 'message',
  ): Promise<string> {
    const flowId = newFlowId();
    await signer.approve?.({ action: 'btc-message', flowId, address: signer.address, message, purpose });
    return signBtcMessage(signer, message, this.bitcoinNetwork, purpose, flowId);
  }

  private get bitcoinNetwork(): bitcoin.Network {
    return this.isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  }

  // Account and address info
  async getAddressInfo(address: string, inSatoshis = true): Promise<IAccountInfo> {
    return this.accountService.addressInfo(address, inSatoshis);
  }

  /**
   * Newest-first history for `address`, at most `limit` entries (default 50).
   * `before` is a txid already seen: only confirmed transactions older than
   * it are returned. Pass the last confirmed txid of one call as the next
   * call's `before` to page back through the history.
   */
  async getTransactions(address: string, limit = 50, before: string | null = null): Promise<ITransaction[]> {
    return this.accountService.transactions(address, limit, before);
  }

  // Transaction operations
  async getFeeRates(): Promise<IFeeRates | null> {
    return this.transactionService.getFeeRates();
  }

  /**
   * Build and sign a payment from `sender`: a WIF, or a BtcSigner that signs
   * the PSBT itself (see `BtcSigner`). `options.addressType` picks which of
   * a WIF's addresses to spend from (default 'p2wpkh'); a BtcSigner says so
   * with its own `addressType`.
   */
  async createTransaction(
    sender: string | BtcSigner,
    recipientAddress: string,
    amount: number,
    feeRate = 0,
    options: { addressType?: BtcSpendType } = {},
  ): Promise<ICreateTxResponse> {
    if (this.dryRun) {
      return {
        success: true,
        result: 'dry_run_transaction_hex',
        error: null,
      };
    }
    if (isBtcSigner(sender)) {
      if (options.addressType && options.addressType !== (sender.addressType ?? 'p2wpkh')) {
        throw new Error(
          `createTransaction: options.addressType ${options.addressType} differs from the BtcSigner's ${
            sender.addressType ?? 'p2wpkh'
          }; set it on the signer`,
        );
      }
      return this.transactionService.createTransactionWithSigner(sender, recipientAddress, amount, feeRate);
    }
    return this.transactionService.createTransaction(sender, recipientAddress, amount, feeRate, options);
  }

  /**
   * What `createTransaction` / `sendBtc` would charge for paying `amountSats`
   * (satoshis, a whole number) to `recipientAddress`, without signing or
   * broadcasting anything: the fee, virtual size, number of inputs, change
   * and whether the balance covers it. Every UTXO of the sender is spent, as
   * the send does, with the same sizes and arithmetic, so a send with the
   * same UTXOs and `feeRate` pays exactly `feeSats`. Pass the fee rate you
   * will send with; 0 fetches the economy rate, which may move before the
   * send fetches it again.
   *
   * `sender` is what the send takes: a WIF (with `options.addressType`,
   * default 'p2wpkh') or a BtcSigner (its own `addressType`; `approve` is not
   * called). It may also be the sending address itself, whose spend type is
   * read from the address. The amount `sendBtc` charges for `amount` BTC is
   * `Math.round(amount * 1e8)` sats.
   *
   * `options.utxos` quotes those coins (Esplora's UTXO shape) instead of
   * fetching the sender's: a caller that already has them makes no request
   * when it also passes a fee rate. For a quote with no I/O at all, on every
   * keystroke, a zero amount or no recipient yet, use `btc.quoteBtcPayment`.
   */
  async quoteTransaction(
    sender: string | BtcSigner,
    recipientAddress: string,
    amountSats: number,
    feeRate = 0,
    options: { addressType?: BtcSpendType; utxos?: ReadonlyArray<IBtcQuoteUtxo> } = {},
  ): Promise<IBtcSendQuote> {
    const { address, spendType } = this.spendingAddress(sender, options.addressType);
    return this.transactionService.quoteTransaction(
      address,
      spendType,
      recipientAddress,
      amountSats,
      feeRate,
      options.utxos,
    );
  }

  /** The address a sender spends from and its spend type, as the send resolves them. */
  private spendingAddress(
    sender: string | BtcSigner,
    addressType: BtcSpendType | undefined,
  ): { address: string; spendType: BtcSpendType } {
    if (isBtcSigner(sender)) {
      const spendType = sender.addressType ?? 'p2wpkh';
      if (addressType && addressType !== spendType) {
        throw new Error(
          `quoteTransaction: options.addressType ${addressType} differs from the BtcSigner's ${spendType}; set it on the signer`,
        );
      }
      assertBtcSignerAddress(sender, this.bitcoinNetwork);
      return { address: sender.address, spendType };
    }
    const fromAddress = spendTypeOfAddress(sender, this.bitcoinNetwork);
    if (fromAddress) {
      if (addressType && spendFamily(addressType) !== spendFamily(fromAddress)) {
        throw new Error(`quoteTransaction: ${sender} is not a ${addressType} address`);
      }
      return { address: sender, spendType: addressType ?? fromAddress };
    }
    const spendType = addressType ?? 'p2wpkh';
    const keyPair = ECPair.fromWIF(sender, this.bitcoinNetwork);
    const address = addressForSpendType(keyPair.publicKey, spendType, this.bitcoinNetwork);
    if (!address) {
      throw new Error(`quoteTransaction: could not get the ${spendType} address of this key`);
    }
    return { address, spendType };
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
  async sendBtc(
    sender: string | BtcSigner,
    recipientAddress: string,
    amount: number,
    feeRate = 0,
    options: { addressType?: BtcSpendType } = {},
  ): Promise<string | null> {
    const createResult = await this.createTransaction(sender, recipientAddress, amount, feeRate, options);

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
