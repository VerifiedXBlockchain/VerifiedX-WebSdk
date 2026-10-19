import base58 from 'bs58';
import CryptoJS from 'crypto-js';
import { Network, RESERVE_ADDRESS_PREFIX } from '../constants';
import { arrayToHex, byteArrayToWordArray } from '../utils';

/**
 * Recipient rules the node enforces when it admits a transaction, checked
 * before building so the caller gets a reason instead of the node's bare
 * "Invalid Transaction". Mirrors Core's `AddressValidateUtility` and
 * `LedgerIntegrityRules.RecipientIsThisNetworks` / `RecipientIsNotAName`.
 */

/** Address version byte per network: mainnet addresses start 'R', testnet 'x'. */
export const ADDRESS_VERSION_BYTE: Record<Network, number> = {
  [Network.Mainnet]: 0x3c,
  [Network.Testnet]: 0x89,
};

/** Shielded (private) addresses carry their own rules. */
export const SHIELDED_ADDRESS_PREFIX = 'zfx_';

/** A name recipient as the node recognises one: any ToAddress containing `.vfx` or `.rbx`. */
export function isNameRecipient(toAddress: string): boolean {
  return /\.(vfx|rbx)/i.test(toAddress);
}

/** The 25 decoded bytes of a well-formed (canonical, checksummed) Base58Check address, else null. */
function decodeBase58Check(address: string): Uint8Array | null {
  if (address.length < 26 || address.length > 35) return null;
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(address);
  } catch {
    return null;
  }
  if (decoded.length !== 25 || base58.encode(decoded) !== address) return null;
  const payload = byteArrayToWordArray(decoded.slice(0, 21));
  const checksum = CryptoJS.SHA256(CryptoJS.SHA256(payload)).toString(CryptoJS.enc.Hex).slice(0, 8);
  return arrayToHex(decoded.slice(21)) === checksum ? decoded : null;
}

/**
 * Whether `address` is a well-formed address of another network (a testnet
 * address on mainnet, a Bitcoin-style version-0 address). Reserve (xRBX),
 * shielded and placeholder (`*_Base`) recipients, names and malformed strings
 * are not: the node judges those by other rules.
 */
export function isOtherNetworksAddress(address: string, network: Network): boolean {
  if (!address || address.startsWith(RESERVE_ADDRESS_PREFIX) || address.startsWith(SHIELDED_ADDRESS_PREFIX)) {
    return false;
  }
  const decoded = decodeBase58Check(address);
  return decoded !== null && decoded[0] !== ADDRESS_VERSION_BYTE[network];
}

/** Throws when the node would refuse `toAddress` as another network's address, at every height. */
export function assertRecipientOnNetwork(toAddress: string, network: Network, label = 'toAddress'): void {
  if (isOtherNetworksAddress(toAddress, network)) {
    const expected = network === Network.Mainnet ? "'R'" : "'x'";
    throw new Error(
      `${label} ${toAddress} is not a ${network} address (${network} addresses start with ${expected}); ` +
        `the network refuses it because nothing sent there could ever be spent`,
    );
  }
}
