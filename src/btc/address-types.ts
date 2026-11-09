import * as bitcoin from 'bitcoinjs-lib';

/**
 * The address a key spends from. `p2wpkh` (bc1q / tb1q) is the default and
 * what every SDK release before this one used; the others spend the same
 * key's other addresses, as `keypairFromWif(...).addresses` lists them:
 *
 * - `p2pkh`: legacy (1… / m… / n…), `addresses.p2pkh`.
 * - `p2sh-p2wpkh`: nested SegWit (3… / 2…), `addresses.p2sh`.
 * - `p2tr`: the Taproot address the SDK and the Flutter wallet show,
 *   `addresses.bech32m`. Its output key is the key itself, NOT tweaked as
 *   BIP 86 requires, so other wallets derive a different address for the
 *   same key.
 * - `p2tr-bip86`: the standard BIP 86 key-path address (output key tweaked
 *   by the key's own hash), what Sparrow, Bitcoin Core and hardware wallets
 *   show for a single-key Taproot account.
 */
export type BtcSpendType = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr' | 'p2tr-bip86';

/** The 32-byte x-only form of a public key, as Taproot uses it. */
export const toXOnly = (pubkey: Buffer): Buffer => (pubkey.length === 33 ? pubkey.subarray(1, 33) : pubkey);

/** The address of `pubkey` for a spend type. */
export function addressForSpendType(pubkey: Buffer, type: BtcSpendType, network: bitcoin.Network): string | undefined {
  switch (type) {
    case 'p2wpkh':
      return bitcoin.payments.p2wpkh({ pubkey, network }).address;
    case 'p2sh-p2wpkh':
      return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network }).address;
    case 'p2pkh':
      return bitcoin.payments.p2pkh({ pubkey, network }).address;
    case 'p2tr':
      return bitcoin.payments.p2tr({ pubkey: toXOnly(pubkey), network }).address;
    case 'p2tr-bip86':
      return bitcoin.payments.p2tr({ internalPubkey: toXOnly(pubkey), network }).address;
  }
}
