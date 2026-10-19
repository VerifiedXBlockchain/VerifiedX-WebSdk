import { RawTransactionApiClient } from '../client/raw-transaction-api-client';
import { Network } from '../constants';
import { KeypairOrSigner, ResolvedSigner, resolveSigner } from '../signer';
import KeypairService from './keypair-service';
import { assertRecipientOnNetwork, isNameRecipient } from './recipient';

export interface IRawTransactionServiceOptions {
  network: Network;
  /**
   * Who signs and pays: a local keypair, or a Signer that holds the key
   * elsewhere (HSM, MPC). `signer` is the same option under a name that reads
   * correctly for external signers; pass one or the other.
   */
  keypair?: KeypairOrSigner | ResolvedSigner;
  signer?: KeypairOrSigner | ResolvedSigner;
  toAddress: string;
  txType?: number;
  amount?: number;
  data?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  /**
   * Unix seconds at which the transaction settles. Required by the node for
   * every send from a reserve (xRBX) account except the reserve operations
   * themselves; null (the default) for everything else.
   */
  unlockTime?: number | null;
  apiOptions?: { baseUrl?: string; timeoutMs?: number };
  /**
   * Throw TransactionRefusedError, carrying the node's reason, when the node
   * refuses the transaction at verification, instead of resolving to null.
   */
  throwOnRefusal?: boolean;
}

export class RawTransactionService {
  private network: Network;
  private signer: ResolvedSigner;
  private toAddress: string;
  private txType: number;
  private amount: number;
  private data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  private fromAddress: string;
  private unlockTime: number | null;
  private apiOptions: { baseUrl?: string; timeoutMs?: number };
  private throwOnRefusal: boolean;

  private hash: string | null = null;
  private nonce: number | null = null;
  private fee: number | null = null;
  private timestamp: number | null = null;
  private signature: string | null = null;

  constructor(options: IRawTransactionServiceOptions) {
    this.network = options.network;
    const signerInput = options.signer ?? options.keypair;
    if (!signerInput) {
      throw new Error('RawTransactionService requires a keypair or a signer');
    }
    // Resolved eagerly so a keypair whose address does not match its key, or a
    // signer wired to the wrong network, fails at construction rather than
    // after the fee and nonce round-trips.
    this.signer = resolveSigner(signerInput, new KeypairService(this.network));
    // The node refuses another network's address at admission, at every
    // height, and a name from PathAuditRulesHeight, with nothing more than
    // "Invalid Transaction". VfxClient resolves names before it gets here.
    if (isNameRecipient(options.toAddress)) {
      throw new Error(
        `toAddress ${options.toAddress} is a name; send to the address it resolves to (VfxClient.lookupDomain)`,
      );
    }
    assertRecipientOnNetwork(options.toAddress, this.network);
    this.toAddress = options.toAddress;
    this.txType = options.txType ?? 0;
    this.amount = options.amount ?? 0;
    this.data = options.data ?? null;
    this.fromAddress = this.signer.address;
    this.unlockTime = options.unlockTime ?? null;
    this.apiOptions = options.apiOptions ?? {};
    this.throwOnRefusal = options.throwOnRefusal ?? false;
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
      UnlockTime: this.unlockTime,
    };
  }

  async process(dryRun = false): Promise<string | null> {
    const client = new RawTransactionApiClient(this.network, this.apiOptions);

    try {
      this.timestamp = await client.getTimestamp();
      this.nonce = await client.getNonce(this.fromAddress);

      let txData = this.updateTransactionData();

      this.fee = await client.getFee(txData);
      txData = this.updateTransactionData();

      this.hash = await client.getHash(txData);

      this.signature = await this.signer.sign(this.hash);

      if (!this.signature) {
        throw new Error('Signature was null');
      }

      const signatureIsValid = await client.validateSignature(this.hash, this.fromAddress, this.signature);

      if (!signatureIsValid) {
        throw new Error('Invalid Signature');
      }

      txData = this.updateTransactionData();

      const verdict = await client.verifyTransactionResult(txData);

      if (!verdict.valid) {
        if (this.throwOnRefusal) {
          throw new TransactionRefusedError(this.hash ?? '', verdict.message);
        }
        throw new Error(verdict.message ? `Invalid Transaction: ${verdict.message}` : 'Invalid Transaction');
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
      if (error instanceof TransactionDispatchError || error instanceof TransactionRefusedError) {
        throw error;
      }
      console.error(`Error in process():`, error);
      return null;
    }
  }
}

/**
 * Thrown, for callers that ask for it, when the node refused the transaction
 * at verification. Nothing was sent; `reason` is the node's message.
 */
export class TransactionRefusedError extends Error {
  readonly hash: string;
  readonly reason: string | null;

  constructor(hash: string, reason: string | null) {
    super(`The node refused transaction ${hash}: ${reason ?? 'no reason given'}. Nothing was sent.`);
    this.name = 'TransactionRefusedError';
    this.hash = hash;
    this.reason = reason;
    Object.setPrototypeOf(this, TransactionRefusedError.prototype);
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
