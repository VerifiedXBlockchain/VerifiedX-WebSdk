import { RawTransactionApiClient } from '../client/raw-transaction-api-client';
import { Network } from '../constants';
import { Keypair } from '../types';
import KeypairService from './keypair-service';

export interface IRawTransactionServiceOptions {
  network: Network;
  keypair: Keypair;
  toAddress: string;
  txType?: number;
  amount?: number;
  data?: Record<string, unknown> | Array<Record<string, unknown>> | null;
}

export class RawTransactionService {
  private network: Network;
  private keypair: Keypair;
  private toAddress: string;
  private txType: number;
  private amount: number;
  private data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  private fromAddress: string;

  private hash: string | null = null;
  private nonce: number | null = null;
  private fee: number | null = null;
  private timestamp: number | null = null;
  private signature: string | null = null;

  constructor(options: IRawTransactionServiceOptions) {
    this.network = options.network;
    this.keypair = options.keypair;
    this.toAddress = options.toAddress;
    this.txType = options.txType ?? 0;
    this.amount = options.amount ?? 0;
    this.data = options.data ?? null;
    this.fromAddress = this.keypair.address;
  }

  private updateTransactionData(): Record<string, unknown> {
    return {
      Hash: this.hash || '',
      ToAddress: this.toAddress,
      FromAddress: this.fromAddress,
      TransactionType: this.txType,
      Amount: this.amount,
      Nonce: this.nonce,
      Fee: this.fee || 0,
      Timestamp: this.timestamp,
      Signature: this.signature || '',
      Height: 0,
      Data: this.data,
      UnlockTime: null,
    };
  }

  async process(dryRun = false): Promise<string | null> {
    const client = new RawTransactionApiClient(this.network);
    const keypairService = new KeypairService(this.network);

    try {
      this.timestamp = await client.getTimestamp();
      this.nonce = await client.getNonce(this.fromAddress);

      let txData = this.updateTransactionData();

      this.fee = await client.getFee(txData);
      txData = this.updateTransactionData();

      this.hash = await client.getHash(txData);

      this.signature = keypairService.getSignature(this.hash, this.keypair.privateKey);

      if (this.signature == null) {
        throw new Error('Signature was null');
      }

      const signatureIsValid = await client.validateSignature(this.hash, this.fromAddress, this.signature);

      if (!signatureIsValid) {
        throw new Error('Invalid Signature');
      }

      txData = this.updateTransactionData();

      const txIsValid = await client.verifyTransaction(txData);

      if (!txIsValid) {
        throw new Error('Invalid Transaction');
      }

      if (dryRun) {
        return this.hash;
      }

      const success = await client.sendTransaction(txData);

      if (!success) {
        throw new Error('Transaction failed to send');
      }

      return this.hash;
    } catch (error) {
      console.error(`Error in process():`, error);
      return null;
    }
  }
}
