/**
 * Whether a vBTC vault contract demonstrably has no media file to ship
 * through a beacon, from the `nft` record Spyglass attaches to the token.
 * Ported from the Flutter wallet's `vbtcContractHasNoMedia`
 * (lib/features/btc_web/services/vbtc_media_detection.dart).
 *
 * Conservative on purpose: true only for a zero-size asset with one of the
 * placeholder names a default-asset vault is minted with (`vbtc_v2_token`,
 * `defaultvBTC*.png`). Calling a vault with media "no media" would skip
 * shipping its file; the other mistake only keeps requiring a beacon.
 */
export function vbtcContractHasNoMedia(nft: unknown): boolean {
  if (!nft || typeof nft !== 'object') return false;
  const record = nft as { primary_asset_size?: unknown; primary_asset_name?: unknown };
  // Only an explicit zero counts: a blank, missing or non-numeric size is
  // not evidence that there is no file.
  const size = record.primary_asset_size;
  const isZero = size === 0 || (typeof size === 'string' && /^\s*0+(\.0+)?\s*$/.test(size));
  if (!isZero) return false;
  const name = typeof record.primary_asset_name === 'string' ? record.primary_asset_name.trim().toLowerCase() : '';
  if (name === '') return false;
  return name === 'vbtc_v2_token' || name.startsWith('defaultvbtc');
}
