import BtcKeypairService from '../btc/keypair';
import { normalizePrivateKey } from '../utils';

/**
 * How the VFX web wallet (vfx-gui, Flutter) reads what a user types at sign
 * in, and how it derives the Bitcoin account that goes with a VFX key. Ported
 * from `lib/features/keygen/utils/private_key_text.dart` and
 * `recovery_phrase.dart`, and pinned against the wallet by
 * `src/__tests__/compat/wallet-flow-vectors.json`.
 *
 * The vault seed and the Bitcoin email and password are cut from the key's
 * TEXT, not its value, so the same key written two ways gives two different
 * vaults. Keep these byte-for-byte with the wallet.
 */

const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const MIN_DERIVATION_TEXT_LENGTH = 32;

const FULL_WIDTH_UPPER_FIRST = 0xff21;
const FULL_WIDTH_UPPER_LAST = 0xff3a;
const FULL_WIDTH_LOWER_FIRST = 0xff41;
const FULL_WIDTH_LOWER_LAST = 0xff5a;
const FULL_WIDTH_OFFSET = 0xfee0;

const stripWhitespace = (text: string): string => text.replace(/\s/g, '');

/**
 * A typed or pasted recovery phrase as the BIP39 check expects it:
 * full-width Latin letters made ASCII, lowercase, and one space between
 * words. Words that are wrong stay wrong.
 */
export function normalizeRecoveryPhrase(input: string): string {
  const ascii = Array.from(input, (char) => {
    const code = char.codePointAt(0) as number;
    const isFullWidthLetter =
      (code >= FULL_WIDTH_UPPER_FIRST && code <= FULL_WIDTH_UPPER_LAST) ||
      (code >= FULL_WIDTH_LOWER_FIRST && code <= FULL_WIDTH_LOWER_LAST);
    return isFullWidthLetter ? String.fromCodePoint(code - FULL_WIDTH_OFFSET) : char;
  }).join('');
  return ascii.toLowerCase().trim().split(/\s+/).join(' ');
}

/**
 * The key as Core's KeyParsing reads it: whitespace and an optional `0x`
 * removed, a valid secp256k1 scalar, written as exactly 64 lowercase hex
 * digits. Null when the input is not a private key.
 */
export function canonicalPrivateKeyHex(input: string): string | null {
  let text = stripWhitespace(input);
  if (text.toLowerCase().startsWith('0x')) {
    text = text.slice(2);
  }
  if (text.length === 0 || !/^[0-9a-fA-F]+$/.test(text)) {
    return null;
  }
  const value = BigInt('0x' + text);
  if (value <= BigInt(0) || value >= SECP256K1_ORDER) {
    return null;
  }
  return value.toString(16).padStart(64, '0');
}

/** The key text with one leading `00` removed, as the wallet cuts seeds from it. */
export function derivationTextFromKeyText(keyText: string): string {
  return keyText.startsWith('00') ? keyText.slice(2) : keyText;
}

/**
 * The derivation text the wallet uses for a key it generated or derived
 * itself (recovery phrase, email/password): its `privateCorrected` form with
 * the `00` removed again. Accepts the SDK's `00`-prefixed 66-character keys.
 * A key whose first byte is zero loses that byte here, exactly as in the
 * wallet.
 */
export function walletDerivationText(privateKey: string): string {
  return derivationTextFromKeyText(normalizePrivateKey(privateKey.toLowerCase()));
}

/**
 * Every text an imported key may have been used with, canonical first: the
 * 65-character form older nodes exported for a key whose top digit is 8 to
 * f, the unpadded form they exported for a key with leading zeros, and the
 * text exactly as pasted. Each gives a different vault and Bitcoin account,
 * so a wallet restores whichever has history. `canonicalHex` comes from
 * `canonicalPrivateKeyHex`.
 */
export function derivationTextCandidates(canonicalHex: string, enteredText?: string): string[] {
  const forms = [canonicalHex];
  if (parseInt(canonicalHex[0], 16) >= 8) {
    forms.push('0' + canonicalHex);
  }
  forms.push(canonicalHex.replace(/^0+/, ''));
  if (enteredText !== undefined) {
    const pasted = stripWhitespace(enteredText);
    if (/^[0-9a-fA-F]+$/.test(pasted) && canonicalPrivateKeyHex(pasted) === canonicalHex) {
      forms.push(pasted);
    }
  }
  const candidates: string[] = [];
  for (const form of forms) {
    const text = derivationTextFromKeyText(form);
    if (text.length >= MIN_DERIVATION_TEXT_LENGTH && !candidates.includes(text)) {
      candidates.push(text);
    }
  }
  return candidates;
}

/** The email and password the wallet feeds to the Bitcoin brain-wallet derivation. */
export function btcCredentialsFromDerivationText(derivationText: string): { email: string; password: string } {
  return {
    email: `${derivationText.slice(0, 8)}@${derivationText.slice(derivationText.length - 8)}.com`,
    password: `${derivationText.slice(0, 12)}${derivationText.slice(derivationText.length - 12)}`,
  };
}

/** The Bitcoin account the wallet pairs with a derivation text. */
export function btcKeypairFromDerivationText(derivationText: string, isTestnet: boolean) {
  const { email, password } = btcCredentialsFromDerivationText(derivationText);
  return new BtcKeypairService(isTestnet).keypairFromEmailPassword(email, password);
}
