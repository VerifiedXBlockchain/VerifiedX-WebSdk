/**
 * The receiver's signed agreement to a BTC name transfer, required from
 * Core's `BtcNameSignerOwnsAddressHeight`. The receiving Bitcoin address's
 * key signs `<unix seconds>:<new VFX owner>:<name>.btc`; the sender puts the
 * message and signature in the transfer as `BTCToMessage`/`BTCToSignature`
 * (Core `BtcNameSignatures.Check`: the owner must match exactly, the name
 * case-insensitively, and the signature is good for 24 hours).
 *
 * The two travel from receiver to sender as one copyable acceptance code,
 * `<message>|<signature>`, the format the VerifiedX wallets use. The message
 * holds no `|`, so the code splits at the first one.
 */

/** Core's `BtcNameSignatures.TransferAcceptanceMaxAgeSeconds`. */
export const BTC_NAME_ACCEPTANCE_MAX_AGE_SECONDS = 24 * 60 * 60;

export const BTC_NAME_ACCEPTANCE_SEPARATOR = '|';

export interface BtcNameAcceptance {
  message: string;
  signature: string;
  /** Unix seconds when the receiver signed. */
  timestamp: number;
  /** The VFX address that will own the name. */
  owner: string;
  name: string;
}

/** `name` lowercased and trimmed, ending in `.btc` exactly once. */
export function normalizeBtcName(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.btc') ? lower : `${lower}.btc`;
}

/** The message the receiving Bitcoin key signs: `<timestamp>:<owner>:<name>.btc`. */
export function btcNameAcceptanceMessage(timestamp: number, owner: string, name: string): string {
  return `${timestamp}:${owner.trim()}:${normalizeBtcName(name)}`;
}

/** The acceptance code the receiver hands to the sender. */
export function buildBtcNameAcceptanceCode(message: string, signature: string): string {
  return `${message}${BTC_NAME_ACCEPTANCE_SEPARATOR}${signature}`;
}

/** The acceptance in `code`, or null when it is not a well-formed code. */
export function parseBtcNameAcceptanceCode(code: string | null | undefined): BtcNameAcceptance | null {
  if (!code) return null;
  const trimmed = code.trim();
  const index = trimmed.indexOf(BTC_NAME_ACCEPTANCE_SEPARATOR);
  if (index <= 0) return null;

  const message = trimmed.slice(0, index).trim();
  const signature = trimmed.slice(index + 1).trim();
  if (!signature || signature.includes(BTC_NAME_ACCEPTANCE_SEPARATOR) || !signature.includes('.')) return null;

  const parsed = parseBtcNameAcceptanceMessage(message);
  return parsed ? { ...parsed, signature } : null;
}

/** The parts of an acceptance message, or null when it is not `<timestamp>:<owner>:<name>`. */
export function parseBtcNameAcceptanceMessage(message: string): Omit<BtcNameAcceptance, 'signature'> | null {
  const parts = message.split(':');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return null;
  const timestamp = Number(parts[0]);
  const [, owner, name] = parts;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !owner || !name) return null;
  return { message, timestamp, owner, name };
}

/**
 * Why the node would refuse this acceptance for a transfer of `name` to
 * `owner` at `nowSeconds`, or null when the parts it can check without the
 * Bitcoin key pass (the signature itself is the node's to verify).
 */
export function btcNameAcceptanceProblem(
  message: string,
  expected: { owner: string; name?: string; nowSeconds?: number },
): string | null {
  const parsed = parseBtcNameAcceptanceMessage(message);
  if (!parsed) return 'the acceptance message is not <timestamp>:<VFX address>:<name>.btc';
  if (parsed.owner !== expected.owner.trim()) {
    return `the acceptance names ${parsed.owner} as the new owner, not ${expected.owner}`;
  }
  if (expected.name && normalizeBtcName(parsed.name) !== normalizeBtcName(expected.name)) {
    return `the acceptance is for ${parsed.name}, not ${normalizeBtcName(expected.name)}`;
  }
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (parsed.timestamp < now - BTC_NAME_ACCEPTANCE_MAX_AGE_SECONDS) {
    return 'the acceptance is more than 24 hours old; the receiver must sign again';
  }
  return null;
}
