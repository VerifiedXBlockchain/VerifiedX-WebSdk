import { canonicalPrivateKeyHex } from './wallet-derivation';

/** Which key of a vault a value was meant to be. */
export type VaultKeyRole = 'vault' | 'recovery';

/**
 * A vault private key or recovery private key that is not a private key: not
 * hex once whitespace and a `0x` prefix are removed, or not a valid secp256k1
 * scalar (zero, or at or above the curve order). Thrown instead of deriving
 * an address from a misread key.
 */
export class InvalidVaultKeyError extends Error {
  readonly role: VaultKeyRole;
  readonly reason: 'not-hex' | 'out-of-range';

  constructor(role: VaultKeyRole, reason: 'not-hex' | 'out-of-range', context: string) {
    super(
      `${context}: the ${role} key is not a private key (${
        reason === 'not-hex' ? 'not hex' : 'zero, or not below the secp256k1 order'
      }). Expected 64 hex digits; whitespace, a 0x prefix and leading zeros are ignored.`,
    );
    this.name = 'InvalidVaultKeyError';
    this.role = role;
    this.reason = reason;
    Object.setPrototypeOf(this, InvalidVaultKeyError.prototype);
  }
}

/**
 * A vault or recovery private key read as an unsigned hex number and written
 * as exactly 64 lowercase hex digits, the way Core reads it. Accepts what
 * Core and the wallets write for the same key: 64 digits, `00` + 64 (the
 * SDK), `0` + 64 (Core's `BigInteger.ToString("x")` when the top digit is 8
 * to f), fewer than 64 (leading zeros dropped), upper case, a `0x` prefix and
 * whitespace anywhere (a key wrapped over lines). Throws InvalidVaultKeyError
 * for anything else. Never use this where the key's TEXT seeds a derivation
 * (see `wallet-derivation.ts`): there each written form is its own account.
 */
export function canonicalVaultKeyHex(input: string, role: VaultKeyRole, context: string): string {
  if (typeof input !== 'string') {
    throw new InvalidVaultKeyError(role, 'not-hex', context);
  }
  const canonical = canonicalPrivateKeyHex(input);
  if (canonical !== null) {
    return canonical;
  }
  const text = input.replace(/\s/g, '').replace(/^0x/i, '');
  throw new InvalidVaultKeyError(role, /^[0-9a-fA-F]+$/.test(text) ? 'out-of-range' : 'not-hex', context);
}
