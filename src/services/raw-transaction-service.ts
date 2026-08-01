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
  apiOptions?: { baseUrl?: string; timeoutMs?: number };
}

export class RawTransactionService {
  private network: Network;
  private keypair: Keypair;
  private toAddress: string;
  private txType: number;
  private amount: number;
  private data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  private fromAddress: string;
  private apiOptions: { baseUrl?: string; timeoutMs?: number };

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
    this.apiOptions = options.apiOptions ?? {};
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
    const client = new RawTransactionApiClient(this.network, this.apiOptions);
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

      // Everything above this line fails before the transaction reaches the
      // node, so `null` honestly means "not sent". Past it, a thrown error is
      // ambiguous: the node may have accepted the transaction and only the
      // response was lost. Reporting that as a clean failure invites the caller
      // to resend and double-spend, so it is surfaced instead of swallowed.
      let success: boolean;
      try {
        success = await client.sendTransaction(txData);
      } catch (error) {
        throw new TransactionDispatchError(this.hash, error);
      }

      if (!success) {
        throw new Error('Transaction failed to send');
      }

      return this.hash;
    } catch (error) {
      if (error instanceof TransactionDispatchError) {
        throw error;
      }
      console.error(`Error in process():`, error);
      return null;
    }
  }
}

/**
 * Thrown when dispatch to the node failed in a way that leaves it unknown
 * whether the transaction was accepted -- a dropped connection or timeout after
 * the request went out.
 *
 * Deliberately not folded into the `null` return that `process()` uses for
 * pre-dispatch failures. `null` means the transaction definitely did not send;
 * this means it might have. Check the chain for `hash` before resending, or a
 * retry risks broadcasting the same spend twice.
 */
export class TransactionDispatchError extends Error {
  readonly hash: string;
  readonly cause: unknown;

  constructor(hash: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Transaction ${hash} was dispatched but the node's response was not received: ${detail}. ` +
        `It may or may not have been accepted -- check the chain for this hash before resending.`,
    );
    this.name = 'TransactionDispatchError';
    this.hash = hash;
    this.cause = cause;
    Object.setPrototypeOf(this, TransactionDispatchError.prototype);
  }
}
