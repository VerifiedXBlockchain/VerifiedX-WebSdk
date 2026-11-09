import { SMART_CONTRACT_DEFAULT_ASSET_LOCATION, SMART_CONTRACT_PLACEHOLDER_UUID } from '../constants';

/**
 * The compiler payload for a VFX10 NFT mint, as the Flutter web wallet sends
 * it to `/raw/smart-contract-data/` (vfx-gui `SmartContract.serializeForCompiler`,
 * origin/testnet 2026-11-08). The node compiles it into Trillium and answers
 * with the mint transaction's Data (`[{ Function: 'Mint()', ContractUID, Data,
 * MD5List }]`, Core `TXV1Controller.GetSCMintDeployData`).
 */

/** Core's feature ids (`FeatureName`). */
export const NFT_FEATURE_EVOLVE = 0;
export const NFT_FEATURE_ROYALTY = 1;
export const NFT_FEATURE_MULTI_ASSET = 2;

/**
 * A media file for an NFT. `url` is where Spyglass can fetch it (the `url`
 * `uploadNftAsset` returns), or `'default'` for an NFT without media.
 */
export interface NftAssetInput {
  url: string;
  /** File name with extension, e.g. `art.png`; defaults to the URL's last segment. */
  name?: string;
  /** Defaults to the name's extension. */
  extension?: string;
  /** Size in bytes; 0 for no media. */
  fileSize?: number;
}

export interface NftEvolvePhaseInput {
  name: string;
  description: string;
  asset?: NftAssetInput;
  properties?: Record<string, string>;
  /** Only for `type: 'blockHeight'`: the height from which this stage is reached. */
  blockHeight?: number;
}

export interface NftMintParams {
  name: string;
  description: string;
  /** The creator name shown on the NFT. */
  minterName: string;
  /** Primary media. Omit for an NFT without media. */
  asset?: NftAssetInput;
  /** More media files carried by the NFT (multi-asset feature). */
  additionalAssets?: NftAssetInput[];
  /** Free-form properties. ':' and '<|>' are removed, as the wallet does, since Trillium uses them as separators. */
  properties?: Record<string, string>;
  /** Paid to `payToAddress` on every sale: a fraction (0.05 = 5%) or a fixed VFX amount. */
  royalty?: { type: 'percent' | 'fixed'; amount: number; payToAddress: string };
  /**
   * Stages the minter can move the NFT through with `evolveNft`. 'manual'
   * stages change only when the minter evolves it; 'blockHeight' stages also
   * become reachable at their height. Time-based evolution is not offered.
   */
  evolve?: { type: 'manual' | 'blockHeight'; phases: NftEvolvePhaseInput[] };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1) : '';
}

function fileNameOf(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0];
  const segment = withoutQuery
    .split('/')
    .filter((s) => s.length > 0)
    .pop();
  return segment ?? 'asset';
}

function sanitizeProperties(properties?: Record<string, string>): Record<string, string> | undefined {
  if (!properties || Object.keys(properties).length === 0) {
    return undefined;
  }
  const clean = (text: string) => text.replace(/:/g, '').replace(/<\|>/g, '');
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [clean(key), clean(String(value))]));
}

/** `SmartContractAsset` for the compiler; `null` input means no media. */
function compilerAsset(asset: NftAssetInput | undefined, minterName: string): Record<string, unknown> {
  if (!asset || asset.url === SMART_CONTRACT_DEFAULT_ASSET_LOCATION) {
    return {
      AssetId: SMART_CONTRACT_PLACEHOLDER_UUID,
      Name: SMART_CONTRACT_DEFAULT_ASSET_LOCATION,
      AssetAuthorName: minterName,
      Location: SMART_CONTRACT_DEFAULT_ASSET_LOCATION,
      Extension: '',
      FileSize: 0,
    };
  }
  const name = asset.name ?? fileNameOf(asset.url);
  return {
    AssetId: SMART_CONTRACT_PLACEHOLDER_UUID,
    Name: name,
    AssetAuthorName: minterName,
    Location: asset.url,
    Extension: asset.extension ?? extensionOf(name),
    FileSize: asset.fileSize ?? 0,
  };
}

export function nftMintPayload(params: NftMintParams & { minterAddress: string }): Record<string, unknown> {
  const name = params.name?.trim();
  if (!name) throw new Error('name is required');
  const minterName = params.minterName?.trim();
  if (!minterName) throw new Error('minterName is required');
  if (!params.description?.trim()) throw new Error('description is required');

  const features: Array<Record<string, unknown>> = [];
  if (params.royalty) {
    const { type, amount, payToAddress } = params.royalty;
    if (!(amount > 0) || (type === 'percent' && amount >= 1)) {
      throw new Error('royalty amount must be above 0 (and below 1 for a percent royalty)');
    }
    if (!payToAddress) throw new Error('royalty payToAddress is required');
    features.push({
      FeatureName: NFT_FEATURE_ROYALTY,
      FeatureFeatures: {
        RoyaltyAmount: amount,
        RoyaltyPayToAddress: payToAddress,
        RoyaltyType: type === 'fixed' ? 0 : 1,
      },
    });
  }
  if (params.evolve && params.evolve.phases.length > 0) {
    const { type } = params.evolve;
    const phases = [...params.evolve.phases];
    if (type === 'blockHeight') {
      if (phases.some((p) => !Number.isInteger(p.blockHeight))) {
        throw new Error("every phase of a 'blockHeight' evolve needs a whole blockHeight");
      }
      phases.sort((a, b) => (a.blockHeight as number) - (b.blockHeight as number));
    }
    features.push({
      FeatureName: NFT_FEATURE_EVOLVE,
      FeatureFeatures: phases.map((phase, index) => {
        const properties = sanitizeProperties(phase.properties);
        return {
          Name: phase.name,
          Description: phase.description,
          IsDynamic: type === 'blockHeight',
          EvolutionState: index + 1,
          IsCurrentState: false,
          SmartContractAsset: phase.asset ? compilerAsset(phase.asset, minterName) : null,
          EvolveDate: null,
          EvolveBlockHeight: type === 'blockHeight' ? phase.blockHeight : null,
          ...(properties && { Properties: properties }),
        };
      }),
    });
  }
  if (params.additionalAssets && params.additionalAssets.length > 0) {
    features.push({
      FeatureName: NFT_FEATURE_MULTI_ASSET,
      FeatureFeatures: params.additionalAssets.map((asset) => {
        const { Name, ...rest } = compilerAsset(asset, minterName);
        return { ...rest, FileName: Name };
      }),
    });
  }

  const properties = sanitizeProperties(params.properties);
  return {
    Name: name,
    MinterName: minterName,
    // The wallet escapes line breaks for the Trillium source the node writes.
    Description: params.description.replace(/\r/g, '').replace(/\n/g, '\\n'),
    SmartContractAsset: compilerAsset(params.asset, minterName),
    IsPublic: false,
    Features: features,
    MinterAddress: params.minterAddress,
    IsMinter: true,
    ...(properties && { Properties: properties }),
    SCVersion: 1,
  };
}

/** The ownership proof the wallet hands out: `address<>message<>signature<>scIdentifier`. */
export function nftOwnershipProof(address: string, message: string, signature: string, scIdentifier: string): string {
  return [address, message, signature, scIdentifier].join('<>');
}
