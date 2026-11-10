import { sha256Hex } from '../crypto';

/**
 * Client-side port of Core's transaction hash (`Models/Transaction.cs`
 * GetHashPreimage / GetHash, origin/testnet 2026-11-08), so a transaction can
 * be built, shown and checked without asking the server for its hash.
 *
 * Core does not hash the JSON the client sends. The fields travel
 * SDK -> Spyglass (Python) -> node (Newtonsoft), and the node hashes what it
 * deserialized:
 *
 *   - Amount and Fee are C# decimals, and decimal.ToString() keeps scale.
 *     Spyglass writes both as Python floats (`_fix_decimals`), the node reads
 *     the float text into a decimal, and Amount is then normalised so a whole
 *     number reads "1.0". The result is the plain decimal expansion of the
 *     number's shortest round-trip digits, with ".0" on whole numbers.
 *   - Data is re-serialised by the node with Newtonsoft (`RawData`:
 *     `JToken.ToString(Formatting.None)`), after Python has turned every
 *     JSON number with a point or exponent into a float. So floats inside
 *     Data are written the .NET way ("1E-05"), integers as written, and
 *     strings with Newtonsoft's escaping.
 *   - TransactionType is the enum NAME, and UnlockTime is appended only when
 *     it is not null (0 is appended).
 *
 * The preimage is a plain concatenation; the hash is SHA-256 of it, then
 * SHA-256 of that lowercase hex TEXT. Pinned against the live testnet
 * `/raw/hash` by src/__tests__/compat/tx-hash-vectors.json.
 */

/** Core's TransactionType names by ordinal (Models/Transaction.cs). Ordinals are pinned in Core. */
export const CORE_TX_TYPE_NAMES: readonly string[] = [
  'TX',
  'NODE',
  'NFT_MINT',
  'NFT_TX',
  'NFT_BURN',
  'NFT_SALE',
  'ADNR',
  'DSTR',
  'VOTE_TOPIC',
  'VOTE',
  'RESERVE',
  'SC_MINT',
  'SC_TX',
  'SC_BURN',
  'FTKN_MINT',
  'FTKN_TX',
  'FTKN_BURN',
  'TKNZ_MINT',
  'TKNZ_TX',
  'TKNZ_BURN',
  'TKNZ_WD_ARB',
  'TKNZ_WD_OWNER',
  'VBTC_V2_VALIDATOR_REGISTER',
  'VBTC_V2_VALIDATOR_HEARTBEAT',
  'VBTC_V2_VALIDATOR_EXIT',
  'VBTC_V2_CONTRACT_CREATE',
  'VBTC_V2_TRANSFER',
  'VBTC_V2_WITHDRAWAL_REQUEST',
  'VBTC_V2_WITHDRAWAL_COMPLETE',
  'VBTC_V2_WITHDRAWAL_CANCEL',
  'VBTC_V2_WITHDRAWAL_VOTE',
  'VFX_SHIELD',
  'VFX_UNSHIELD',
  'VFX_PRIVATE_TRANSFER',
  'VBTC_V2_SHIELD',
  'VBTC_V2_UNSHIELD',
  'VBTC_V2_PRIVATE_TRANSFER',
  'VBTC_V2_BRIDGE_LOCK',
  'VBTC_V2_BRIDGE_UNLOCK',
  'VBTC_V2_BRIDGE_POOL_UNLOCK',
  'VBTC_V2_BRIDGE_EXIT_TO_BTC',
  'VBTC_V2_BRIDGE_EXIT_TO_BTC_COMPLETE',
  'VBTC_V2_BRIDGE_EXIT_TO_BTC_FAIL',
  'VBTC_V2_BTC_REPORT',
  'VBTC_V2_COIN_PIN',
  'VBTC_V2_BTC_REORG',
  'VBTC_V2_VAULT_REKEY',
];

/**
 * Privacy types hash a different preimage (`Transaction.BuildPrivate`) that
 * depends on the block height. They are not ported; build them on the server.
 */
const PRIVATE_TX_TYPES = new Set([31, 32, 33, 34, 35, 36]);

/** The fields the hash covers, as the SDK sends them to `/raw/*`. */
export interface HashableTransaction {
  Timestamp: number;
  FromAddress: string;
  ToAddress: string;
  Amount: number;
  Fee: number;
  Nonce: number;
  TransactionType: number;
  Data?: unknown;
  UnlockTime?: number | null;
}

export function coreTxTypeName(txType: number): string {
  const name = CORE_TX_TYPE_NAMES[txType];
  if (name === undefined) {
    throw new Error(`Unknown transaction type ${txType}; it cannot be hashed locally`);
  }
  return name;
}

export function canHashLocally(txType: number): boolean {
  return CORE_TX_TYPE_NAMES[txType] !== undefined && !PRIVATE_TX_TYPES.has(txType);
}

/** Shortest round-trip digits and decimal exponent: 0.00025 -> { digits: '25', exponent: -4 }. */
function shortestDigits(value: number): { negative: boolean; digits: string; exponent: number } {
  const [mantissa, exponentText] = Math.abs(value).toExponential().split('e');
  return { negative: value < 0, digits: mantissa.replace('.', ''), exponent: Number(exponentText) };
}

function plainExpansion(digits: string, exponent: number): string {
  // The first digit sits at 10^exponent.
  if (exponent < 0) {
    return '0.' + '0'.repeat(-exponent - 1) + digits;
  }
  if (digits.length <= exponent + 1) {
    return digits + '0'.repeat(exponent + 1 - digits.length);
  }
  return digits.slice(0, exponent + 1) + '.' + digits.slice(exponent + 1);
}

/**
 * Amount or Fee as the node's decimal.ToString() writes it after the
 * Spyglass float round trip: 1 -> "1.0", 0 -> "0.0", 0.00002 -> "0.00002".
 */
export function coreDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot hash a non-finite amount: ${value}`);
  }
  if (value === 0) {
    return '0.0';
  }
  const { negative, digits, exponent } = shortestDigits(value);
  const text = plainExpansion(digits, exponent);
  return (negative ? '-' : '') + (text.includes('.') ? text : text + '.0');
}

/**
 * A float as Newtonsoft writes it: .NET's shortest round-trip digits, in
 * scientific notation when the decimal exponent is below -4 or at least
 * max(15, digit count) (.NET 'R': Scale > nMaxDigits || Scale < -3). Checked
 * against the testnet node: 1E-05, 0.0001, 1234567890123456.8, 1E+21.
 */
function dotnetDouble(value: number): string {
  if (value === 0) {
    return '0.0';
  }
  const { negative, digits, exponent } = shortestDigits(value);
  let text: string;
  if (exponent < -4 || exponent >= Math.max(15, digits.length)) {
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const sign = exponent < 0 ? '-' : '+';
    text = `${mantissa}E${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  } else {
    text = plainExpansion(digits, exponent);
    if (!text.includes('.')) {
      text += '.0';
    }
  }
  return (negative ? '-' : '') + text;
}

/** Newtonsoft's default string escaping (StringEscapeHandling.Default). */
function newtonsoftString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === '"') out += '\\"';
    else if (char === '\\') out += '\\\\';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (char === '\b') out += '\\b';
    else if (char === '\f') out += '\\f';
    else if (code < 0x20 || code === 0x85 || code === 0x2028 || code === 0x2029)
      out += '\\u' + code.toString(16).padStart(4, '0');
    else out += char;
  }
  return out + '"';
}

/** A JSON value (already through JSON.parse) re-serialised the way the node does. */
function nodeJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    // JSON.stringify writes whole numbers below 1e21 without a point or an
    // exponent, which Python keeps as int; anything else becomes a float.
    const written = JSON.stringify(value);
    return /[.eE]/.test(written) ? dotnetDouble(value) : written;
  }
  if (typeof value === 'string') return newtonsoftString(value);
  if (Array.isArray(value)) return '[' + value.map(nodeJson).join(',') + ']';
  if (typeof value === 'object') {
    return (
      '{' +
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => `${newtonsoftString(key)}:${nodeJson(entry)}`)
        .join(',') +
      '}'
    );
  }
  throw new Error(`Cannot hash a ${typeof value} inside Data`);
}

/** The Data string the node hashes; empty for null or missing Data. */
export function coreDataString(data: unknown): string {
  if (data === null || data === undefined) {
    return '';
  }
  return nodeJson(JSON.parse(JSON.stringify(data)));
}

/** `Transaction.GetHashPreimage()`: the exact text the hash is computed over. */
export function transactionHashPreimage(tx: HashableTransaction): string {
  if (PRIVATE_TX_TYPES.has(tx.TransactionType)) {
    throw new Error(`Transaction type ${tx.TransactionType} uses the private hash and cannot be hashed locally`);
  }
  const preimage =
    `${tx.Timestamp}${tx.FromAddress}${tx.ToAddress}${coreDecimalString(tx.Amount)}${coreDecimalString(tx.Fee)}` +
    `${tx.Nonce}${coreTxTypeName(tx.TransactionType)}${coreDataString(tx.Data)}`;
  return tx.UnlockTime === null || tx.UnlockTime === undefined ? preimage : `${preimage}${tx.UnlockTime}`;
}

function sha256Utf8Hex(text: string): string {
  return sha256Hex(text);
}

/** `HashingService.GenerateHash` applied twice to a preimage. */
export function hashPreimage(preimage: string): string {
  return sha256Utf8Hex(sha256Utf8Hex(preimage));
}

/** `Transaction.GetHash()`: what the node signs and verifies. */
export function transactionHash(tx: HashableTransaction): string {
  return hashPreimage(transactionHashPreimage(tx));
}
