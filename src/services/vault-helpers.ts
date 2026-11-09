import CryptoJS from 'crypto-js';
import { RESERVE_ADDRESS_PREFIX, RESERVE_BASE_ADDRESS } from '../constants';
import { Transaction } from '../types';

/**
 * Whether the vault that sent `tx` can still call it back: it is a confirmed
 * send from `vaultAddress` whose unlock time has not passed, and no CallBack()
 * in `vaultHistory` already names it. Mirrors the Flutter web wallet's
 * WebCallbackButton (lib/features/web/components/web_callback_button.dart).
 * `vaultHistory` is the vault's own transaction list; without it, a send
 * already called back still reads as callable.
 */
export function canCallBackReserveTransaction(
  tx: Pick<Transaction, 'hash' | 'from_address' | 'to_address' | 'height' | 'unlock_time'>,
  vaultAddress: string,
  opts: { vaultHistory?: Array<Pick<Transaction, 'callback_details'>>; now?: number } = {},
): boolean {
  if (!vaultAddress.startsWith(RESERVE_ADDRESS_PREFIX) || tx.from_address !== vaultAddress) return false;
  if (tx.to_address === RESERVE_BASE_ADDRESS) return false; // register, callback and recover settle at once
  if (!(tx.height > 0) || !tx.unlock_time) return false;
  const unlocksAt = Date.parse(tx.unlock_time);
  if (!Number.isFinite(unlocksAt) || unlocksAt <= (opts.now ?? Date.now())) return false;
  const calledBack = (opts.vaultHistory ?? []).some(
    (other) => (other.callback_details as { hash?: unknown } | null)?.hash === tx.hash,
  );
  return !calledBack;
}

const BACKUP_PREFIX = 'vfxvault1-';

function checksum(privateKeyHex: string): string {
  return CryptoJS.SHA256(`${BACKUP_PREFIX}${privateKeyHex}`).toString(CryptoJS.enc.Hex).slice(0, 8);
}

/**
 * A backup string for a vault key on its own: `vfxvault1-<64 hex><8 hex
 * checksum>`. It deliberately holds no recovery key: back that up apart, or
 * the recovery key protects nothing. `vaultKeyFromBackupCode` reads it back
 * and refuses a mistyped code. For a code the CLI and Flutter wallet can
 * import, use `reserveRestoreCode` (which does hold both keys).
 */
export function vaultBackupCode(vaultPrivateKey: string): string {
  const hex = vaultPrivateKey
    .trim()
    .toLowerCase()
    .replace(/^00(?=[0-9a-f]{64}$)/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('vaultBackupCode: expected a 64-hex vault private key');
  return `${BACKUP_PREFIX}${hex}${checksum(hex)}`;
}

/** The vault private key (00-prefixed, as the SDK writes keys) in a `vaultBackupCode`. */
export function vaultKeyFromBackupCode(code: string): string {
  const text = code.trim().toLowerCase();
  const match = text.startsWith(BACKUP_PREFIX)
    ? /^([0-9a-f]{64})([0-9a-f]{8})$/.exec(text.slice(BACKUP_PREFIX.length))
    : null;
  if (!match) throw new Error(`Not a vault backup code: expected ${BACKUP_PREFIX}<72 hex characters>`);
  if (checksum(match[1]) !== match[2]) throw new Error('Vault backup code checksum does not match; check it for typos');
  return '00' + match[1];
}

/**
 * The CLI and Flutter wallet restore code, `base64("<vault key>//<recovery
 * key>")`, for a vault and an independent recovery key. It holds both keys,
 * so whoever has it can both spend and recover the vault: store it like the
 * vault key, or keep the recovery key's backup apart instead.
 */
export function reserveRestoreCode(vaultPrivateKey: string, recoveryPrivateKey: string): string {
  const strip = (key: string) =>
    key
      .trim()
      .toLowerCase()
      .replace(/^00(?=[0-9a-f]{64}$)/, '');
  const vault = strip(vaultPrivateKey);
  const recovery = strip(recoveryPrivateKey);
  if (!/^[0-9a-f]{64}$/.test(vault) || !/^[0-9a-f]{64}$/.test(recovery)) {
    throw new Error('reserveRestoreCode: expected two 64-hex private keys');
  }
  return Buffer.from(`${vault}//${recovery}`, 'utf-8').toString('base64');
}
