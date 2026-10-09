/**
 * Thrown when a signed Bitcoin transaction was handed to the broadcast
 * endpoint but no definite answer came back (network error, timeout, an error
 * status that does not say the node refused it). The transaction may or may
 * not be on the network.
 *
 * Do not build a new transaction for the same payment while this one may be
 * out there: a new transaction can spend other coins (or this one's change)
 * and pay the recipient twice. Re-broadcasting `signedTxHex` is always safe —
 * it is the same transaction and can confirm at most once. Use
 * `BtcClient.checkBroadcast(signedTxHex)` to see whether it reached the
 * network or can no longer confirm.
 */
export class BtcBroadcastUnknownError extends Error {
  readonly txid: string;
  readonly signedTxHex: string;
  readonly cause: unknown;

  constructor(txid: string, signedTxHex: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Bitcoin transaction ${txid} was sent for broadcast but the outcome is unknown: ${detail}. ` +
        `It may be on the network. Do not build a new transaction for this payment: look the txid up ` +
        `and, if it is absent, re-broadcast signedTxHex (the same transaction can only confirm once).`,
    );
    this.name = 'BtcBroadcastUnknownError';
    this.txid = txid;
    this.signedTxHex = signedTxHex;
    this.cause = cause;
    Object.setPrototypeOf(this, BtcBroadcastUnknownError.prototype);
  }
}
