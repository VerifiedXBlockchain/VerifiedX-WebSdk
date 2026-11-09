import { RawTransactionApiClient } from '../client/raw-transaction-api-client';
import { coreDataString, coreDecimalString, HashableTransaction } from './transaction-hash';

/**
 * Where a transaction's hash comes from.
 *
 * - `server`: Spyglass builds it (`/raw/timestamp`, `/raw/fee`, `/raw/hash`,
 *   `/raw/validate-signature`, `/raw/verify`), as every SDK before 9.1 did.
 * - `both` (default): the SDK builds the transaction and its hash itself, and
 *   also asks `/raw/hash` and throws TransactionHashMismatchError when the
 *   two differ. Nothing is signed on a mismatch.
 * - `local`: the SDK builds it alone. Only the nonce and the send go to the
 *   server (and `/raw/verify` when `preflight` is on).
 */
export type HashMode = 'server' | 'both' | 'local';

export const DEFAULT_HASH_MODE: HashMode = 'both';

/** Thrown when the locally computed hash differs from the server's. Nothing was signed or sent. */
export class TransactionHashMismatchError extends Error {
  readonly localHash: string;
  readonly serverHash: string;
  readonly preimage: string;

  constructor(localHash: string, serverHash: string, preimage: string) {
    super(
      `The local transaction hash ${localHash} differs from the server's ${serverHash}; nothing was signed. ` +
        `Use hashMode 'server' and report the transaction (preimage: ${preimage}).`,
    );
    this.name = 'TransactionHashMismatchError';
    this.localHash = localHash;
    this.serverHash = serverHash;
    this.preimage = preimage;
    Object.setPrototypeOf(this, TransactionHashMismatchError.prototype);
  }
}

// FeeCalcService.CalculateTXFee: (JSON size / 1024) × 0.00002, rounded up at
// the 8th decimal place. Counted in units of 1e-8 VFX.
const FEE_UNITS_PER_KB = 2000;
const UNITS_PER_VFX = 100_000_000;
/**
 * The validator refuses a fee of 0.000003 or less for every fee-paying type
 * (TransactionValidatorService), although the builder's own floor is exactly
 * 0.000003, so the local floor sits one step above it.
 */
const LOCAL_FEE_FLOOR_UNITS = 400;
/** Bytes added to the size estimate, so the local fee never undercuts the node's. */
const FEE_SIZE_MARGIN_BYTES = 256;

/**
 * The fee the node would quote for this transaction, with a margin. The node
 * never recomputes it: the validator only checks the floor, so an estimate
 * that is a little high is safe and one that is low is not. Size is the
 * length of the Newtonsoft JSON of the transaction as `GetRawTxFee`
 * serialises it.
 */
export function localTransactionFee(tx: Omit<HashableTransaction, 'Fee'>): number {
  const data = coreDataString(tx.Data);
  const json =
    `{"Id":null,"Hash":null,"ToAddress":${JSON.stringify(tx.ToAddress)},"FromAddress":${JSON.stringify(
      tx.FromAddress,
    )},` +
    `"Amount":${coreDecimalString(tx.Amount)},"Nonce":${tx.Nonce},"Fee":0.0,"Timestamp":${tx.Timestamp},` +
    `"Data":${data === '' ? 'null' : JSON.stringify(data)},"UnlockTime":${tx.UnlockTime ?? 'null'},` +
    `"Signature":null,"Height":0,"TransactionType":${tx.TransactionType},"TransactionRating":null,"TransactionStatus":null}`;
  const size = Buffer.byteLength(json, 'utf8') + FEE_SIZE_MARGIN_BYTES;
  const units = Math.max(Math.ceil((size * FEE_UNITS_PER_KB) / 1024), LOCAL_FEE_FLOOR_UNITS);
  return units / UNITS_PER_VFX;
}

/**
 * State that outlives one transaction: the offset between this device's clock
 * and the node's, and the next nonce per sender. A VfxClient keeps one; a
 * RawTransactionService used on its own gets a fresh one.
 */
export class TxBuildSession {
  private clockOffsetSeconds: number | null = null;
  private readonly nextNonces = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * The node's current time. Core refuses a transaction stamped more than 120
   * seconds ahead of it or more than an hour behind, and device clocks drift,
   * so the server time is read once and the offset applied from then on.
   */
  async timestamp(client: RawTransactionApiClient): Promise<number> {
    const local = Math.floor(this.now() / 1000);
    if (this.clockOffsetSeconds === null) {
      const server = await client.getTimestamp();
      if (!Number.isFinite(server) || server <= 0) {
        throw new Error(`Unexpected server timestamp: ${server}`);
      }
      this.clockOffsetSeconds = server - local;
      return server;
    }
    return local + this.clockOffsetSeconds;
  }

  /** The next nonce for a sender, or undefined when nothing has been sent from it in this session. */
  cachedNonce(address: string): number | undefined {
    return this.nextNonces.get(address);
  }

  /**
   * The nonce to use given the server's answer. The server's index can lag a
   * send this session just made, so the higher of the two wins.
   */
  reconcileNonce(address: string, serverNonce: number): number {
    const cached = this.nextNonces.get(address);
    return cached === undefined ? serverNonce : Math.max(serverNonce, cached);
  }

  recordSent(address: string, nonce: number): void {
    this.nextNonces.set(address, nonce + 1);
  }

  /** Forget the cached nonce, e.g. after the node refused a transaction. */
  forgetNonce(address: string): void {
    this.nextNonces.delete(address);
  }
}
