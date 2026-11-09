import { RawTransactionApiClient } from '../client/raw-transaction-api-client';
import { Network } from '../constants';
import {
  KeypairOrSigner,
  ResolvedSigner,
  SigningTransaction,
  approveIntent,
  newFlowId,
  resolveSigner,
} from '../signer';
import KeypairService, { verifySignature } from './keypair-service';
import { assertRecipientOnNetwork, isNameRecipient } from './recipient';
import { canHashLocally, transactionHash, transactionHashPreimage } from './transaction-hash';
import {
  DEFAULT_HASH_MODE,
  HashMode,
  TransactionHashMismatchError,
  TxBuildSession,
  localTransactionFee,
} from './tx-build-session';

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
  /**
   * Called with the transaction as it will be signed (fee and hash filled in),
   * before the key signs it. Throw PreSignCheckError to refuse it; nothing is
   * signed or sent, and process() rethrows that error.
   */
  beforeSign?: (tx: Record<string, unknown>) => void;
  /** Who builds the timestamp, fee and hash; see HashMode. Default 'both'. */
  hashMode?: HashMode;
  /**
   * Ask the node to verify the transaction (`/raw/verify`) before sending.
   * Default true for 'server' and 'both', false for 'local'. In a dry run
   * the transaction is always verified.
   */
  preflight?: boolean;
  /** Clock offset and next-nonce cache shared across sends (VfxClient passes its own). */
  session?: TxBuildSession;
  /** Id of the user action this transaction belongs to, passed to the signer. */
  flowId?: string;
  /** The signer already approved this action (`Signer.approve`); do not ask again. */
  approved?: boolean;
}

/** Seconds added to the clock for a fee quote, so the timestamp digits never grow past it. */
const QUOTE_TIMESTAMP_HEADROOM_SECONDS = 3600;
/** A nonce longer than any real one, for the same reason. */
const QUOTE_NONCE_UPPER_BOUND = 999_999_999_999;

/** a + b in VFX without binary float noise (8 decimal places, as Core rounds fees). */
function addVfx(a: number, b: number): number {
  return Math.round((a + b) * 100_000_000) / 100_000_000;
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
  private beforeSign: ((tx: Record<string, unknown>) => void) | null;
  private hashMode: HashMode;
  private preflight: boolean;
  private session: TxBuildSession;
  private flowId: string;
  private approved: boolean;

  private hash: string | null = null;
  private nonce: number | null = null;
  private fee: number | null = null;
  private timestamp: number | null = null;
  private signature: string | null = null;
  private hashPreimage: string | null = null;
  /** The fee shown in the approval, once quoted; the transaction is built with exactly this fee. */
  private quotedFee: number | null = null;

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
    this.beforeSign = options.beforeSign ?? null;
    // Privacy types hash a height-dependent preimage that is not ported.
    this.hashMode = canHashLocally(this.txType) ? options.hashMode ?? DEFAULT_HASH_MODE : 'server';
    this.preflight = options.preflight ?? this.hashMode !== 'local';
    this.session = options.session ?? new TxBuildSession();
    this.flowId = options.flowId ?? newFlowId();
    this.approved = options.approved ?? false;
  }

  private signingTransaction(): SigningTransaction {
    return {
      Hash: this.hash ?? '',
      FromAddress: this.fromAddress,
      ToAddress: this.toAddress,
      TransactionType: this.txType,
      Amount: this.amount,
      Fee: this.fee ?? 0,
      Nonce: this.nonce ?? 0,
      Timestamp: this.timestamp ?? 0,
      Data: this.data,
      UnlockTime: this.unlockTime,
    };
  }

  /**
   * Timestamp, nonce, fee and hash. 'server' asks Spyglass for each, as
   * before 9.1. Otherwise they are built here: the timestamp from the
   * session's server-clock offset, the fee from the size formula, the hash
   * from Core's preimage; the nonce still comes from the server unless
   * 'local' has one cached from this session's last send. 'both' also asks
   * `/raw/hash` and refuses to go on when the answers differ.
   */
  private async build(client: RawTransactionApiClient): Promise<void> {
    if (this.hashMode === 'server') {
      this.timestamp = await client.getTimestamp();
      this.nonce = await client.getNonce(this.fromAddress);
      this.fee = this.quotedFee ?? (await client.getFee(this.updateTransactionData()));
      this.hash = await client.getHash(this.updateTransactionData());
      return;
    }

    this.timestamp = await this.session.timestamp(client);
    const cached = this.hashMode === 'local' ? this.session.cachedNonce(this.fromAddress) : undefined;
    this.nonce = cached ?? this.session.reconcileNonce(this.fromAddress, await client.getNonce(this.fromAddress));
    const needed = localTransactionFee(this.signingTransaction());
    if (this.quotedFee !== null && needed > this.quotedFee) {
      // Cannot happen with the quote's upper-bound timestamp and nonce; if it
      // did, sending more than the person approved would be worse than failing.
      throw new Error(`The fee rose from the approved ${this.quotedFee} to ${needed} VFX; nothing was signed`);
    }
    this.fee = this.quotedFee ?? needed;
    const fields = this.signingTransaction();
    this.hashPreimage = transactionHashPreimage(fields);
    this.hash = transactionHash(fields);
    if (this.hashMode === 'both') {
      const serverHash = await client.getHash(this.updateTransactionData());
      if (serverHash !== this.hash) {
        throw new TransactionHashMismatchError(this.hash, serverHash, this.hashPreimage);
      }
    }
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

  /**
   * The fee this transaction will carry, and the total it takes from the
   * sender (amount + fee), before anything is signed. In 'both' and 'local'
   * the quote is computed locally and is the exact fee the transaction is
   * then built with. In 'server' mode it is Spyglass's `/raw/fee`, and is
   * likewise reused as the fee. Quoting once fixes the fee for this
   * service; call it again only to read the same values back.
   */
  async quote(): Promise<{ fee: number; amount: number; total: number }> {
    if (this.quotedFee === null) {
      this.quotedFee = await this.computeQuote(new RawTransactionApiClient(this.network, this.apiOptions));
    }
    return { fee: this.quotedFee, amount: this.amount, total: addVfx(this.amount, this.quotedFee) };
  }

  /**
   * An upper bound on the size-based fee: the timestamp a little in the
   * future and a nonce longer than any real one, so the transaction built
   * later is never larger than the one quoted.
   */
  private async computeQuote(client: RawTransactionApiClient): Promise<number> {
    const upperBound = {
      ...this.signingTransaction(),
      Timestamp: Math.floor(Date.now() / 1000) + QUOTE_TIMESTAMP_HEADROOM_SECONDS,
      Nonce: QUOTE_NONCE_UPPER_BOUND,
    };
    if (this.hashMode === 'server') {
      return client.getFee({
        ...this.updateTransactionData(),
        Timestamp: upperBound.Timestamp,
        Nonce: upperBound.Nonce,
      });
    }
    return localTransactionFee(upperBound);
  }

  async process(dryRun = false): Promise<string | null> {
    const client = new RawTransactionApiClient(this.network, this.apiOptions);

    // Before anything is built, so the timestamp is taken after the person
    // approved. A signer that throws here cancels: the error reaches the
    // caller, and nothing was built, signed or sent. The fee is quoted
    // first so the approval can show it; in 'server' mode only when the
    // signer asks for approval, so the old pipeline is otherwise unchanged.
    if (!this.approved) {
      const wantsApproval = typeof this.signer.approve === 'function';
      const quote = wantsApproval || this.hashMode !== 'server' ? await this.quote() : null;
      await approveIntent(this.signer, {
        action: 'transaction',
        flowId: this.flowId,
        fromAddress: this.fromAddress,
        toAddress: this.toAddress,
        amount: this.amount,
        txType: this.txType,
        data: this.data,
        unlockTime: this.unlockTime,
        ...(quote && { fee: quote.fee, total: quote.total }),
      });
      this.approved = true;
    }

    try {
      await this.build(client);
      this.beforeSign?.(this.updateTransactionData());

      const hash = this.hash as string;
      this.signature = await this.signer.sign(hash, {
        kind: 'transaction',
        flowId: this.flowId,
        message: hash,
        transaction: this.signingTransaction(),
        hashSource: this.hashMode === 'server' ? 'server' : 'local',
        ...(this.hashPreimage !== null && { hashPreimage: this.hashPreimage }),
      });

      if (!this.signature) {
        throw new Error('Signature was null');
      }

      const signatureIsValid =
        this.hashMode === 'server'
          ? await client.validateSignature(hash, this.fromAddress, this.signature)
          : verifySignature(hash, this.signature, this.fromAddress);

      if (!signatureIsValid) {
        throw new Error('Invalid Signature');
      }

      const txData = this.updateTransactionData();

      if (this.preflight || dryRun) {
        const verdict = await client.verifyTransactionResult(txData);

        if (!verdict.valid) {
          if (this.throwOnRefusal) {
            throw new TransactionRefusedError(hash, verdict.message);
          }
          throw new Error(verdict.message ? `Invalid Transaction: ${verdict.message}` : 'Invalid Transaction');
        }
      }

      if (dryRun) {
        return hash;
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
        throw new TransactionDispatchError(hash, error);
      }

      if (!success) {
        throw new Error('Transaction failed to send');
      }

      this.session.recordSent(this.fromAddress, this.nonce as number);
      return hash;
    } catch (error) {
      // Whatever went wrong, the cached next nonce is no longer known to be
      // right: a dispatch whose answer was lost may have consumed it.
      this.session.forgetNonce(this.fromAddress);
      if (
        error instanceof TransactionDispatchError ||
        error instanceof TransactionRefusedError ||
        error instanceof PreSignCheckError ||
        error instanceof TransactionHashMismatchError
      ) {
        throw error;
      }
      console.error(`Error in process():`, error);
      return null;
    }
  }
}

/** Thrown by a `beforeSign` check that refuses the transaction. Nothing was signed or sent. */
export class PreSignCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreSignCheckError';
    Object.setPrototypeOf(this, PreSignCheckError.prototype);
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
