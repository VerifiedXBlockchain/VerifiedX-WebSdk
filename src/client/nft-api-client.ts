import { Network } from '../constants';
import { PaginatedResponse } from '../types';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient } from './base-api-client';

/** An NFT as Spyglass indexes it (`/api/nft/`). */
export interface VfxNft {
  identifier: string;
  name: string;
  description: string;
  minter_address: string;
  owner_address: string;
  minter_name: string;
  /**
   * The contract's state as the node reports it: JSON text of
   * `{ SmartContractMain: { SmartContractAsset, Features, ... }, CurrentOwner }`.
   * `nftContract(nft)` parses it.
   */
  smart_contract_data: string | Record<string, unknown> | null;
  primary_asset_name: string;
  primary_asset_size: number;
  minted_at: string;
  mint_transaction: unknown;
  burn_transaction: unknown;
  is_burned: boolean;
  data: unknown;
  /** Media file name -> URL Spyglass serves it from. */
  asset_urls: Record<string, string> | null;
  is_listed: boolean;
}

export interface NftListQuery {
  ownerAddress?: string;
  minterAddress?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** NFT reads from Spyglass. Failures throw VfxApiError. */
export class NftApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/nft', network, ...options });
  }

  async listNfts(query: NftListQuery = {}): Promise<PaginatedResponse<VfxNft>> {
    return this.makeJsonRequest('/', 'GET', listParams(query));
  }

  /** NFTs owned by any of `addresses` (a wallet's main account and its vault, say). */
  async listNftsForAddresses(
    addresses: string[],
    query: Omit<NftListQuery, 'ownerAddress' | 'minterAddress'> = {},
  ): Promise<PaginatedResponse<VfxNft>> {
    const joined = addresses.map(encodeURIComponent).join(',');
    return this.makeJsonRequest(`/addresses/${joined}/`, 'GET', listParams(query));
  }

  async getNft(scIdentifier: string): Promise<VfxNft> {
    return this.makeJsonRequest(`/${encodeURIComponent(scIdentifier)}/`);
  }

  async getNftHistory(scIdentifier: string): Promise<unknown> {
    return this.makeJsonRequest(`/${encodeURIComponent(scIdentifier)}/history/`);
  }

  /** Ask the node whether an ownership proof (`address<>message<>signature<>scIdentifier`) holds. */
  async verifyOwnership(proof: string): Promise<boolean> {
    const response = await this.makeJsonRequest('/verify-ownership/', 'POST', { signature: proof });
    return response?.verified === true;
  }
}

function listParams(query: NftListQuery): Record<string, unknown> {
  return {
    ...(query.ownerAddress && { owner_address: query.ownerAddress }),
    ...(query.minterAddress && { minter_address: query.minterAddress }),
    ...(query.search && { search: query.search }),
    page: query.page ?? 1,
    ...(query.limit !== undefined && { limit: query.limit }),
  };
}

/** One evolve stage of an NFT, as the node reports it. */
export interface NftEvolveStage {
  EvolutionState: number;
  Name: string;
  Description: string;
  IsCurrentState: boolean;
  [key: string]: unknown;
}

/**
 * The parsed `SmartContractMain` of an NFT from Spyglass (`smart_contract_data`
 * arrives as JSON text), or null when Spyglass has none.
 */
export function nftContract(nft: Pick<VfxNft, 'smart_contract_data'>): Record<string, unknown> | null {
  let data: unknown = nft.smart_contract_data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') {
    return null;
  }
  const main = (data as { SmartContractMain?: unknown }).SmartContractMain;
  return (main && typeof main === 'object' ? main : data) as Record<string, unknown>;
}

/** The NFT's evolve stages in order, or [] when it does not evolve. */
export function nftEvolveStages(nft: Pick<VfxNft, 'smart_contract_data'>): NftEvolveStage[] {
  const features = nftContract(nft)?.Features;
  if (!Array.isArray(features)) {
    return [];
  }
  const evolve = features.find((feature) => feature?.FeatureName === 0)?.FeatureFeatures;
  return Array.isArray(evolve) ? (evolve as NftEvolveStage[]) : [];
}

/** The evolve stage the NFT is in, or null (not evolving, or still at its base state). */
export function nftCurrentStage(nft: Pick<VfxNft, 'smart_contract_data'>): number | null {
  return nftEvolveStages(nft).find((stage) => stage.IsCurrentState)?.EvolutionState ?? null;
}

/**
 * Whether the NFT has no media files: its primary asset is the 'default'
 * placeholder of size 0 and it has no additional assets. Such an NFT
 * transfers with locator "NA" and needs no beacon.
 */
export function nftIsMedialess(
  nft: Pick<VfxNft, 'smart_contract_data' | 'primary_asset_name' | 'primary_asset_size'>,
): boolean {
  const contract = nftContract(nft);
  const asset = contract?.SmartContractAsset as { Name?: unknown; FileSize?: unknown } | undefined;
  const name = asset?.Name ?? nft.primary_asset_name;
  const size = Number(asset?.FileSize ?? nft.primary_asset_size ?? 0);
  const features = contract?.Features;
  const hasMoreMedia = Array.isArray(features) && features.some((feature) => feature?.FeatureName === 2);
  return name === 'default' && size === 0 && !hasMoreMedia;
}
