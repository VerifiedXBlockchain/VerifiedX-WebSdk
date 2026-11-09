import { Network } from '../constants';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient } from './base-api-client';

/** Which of an owner's NFTs are listed for sale on the shop (`/nft/listed/{owner}/`). */
export class NftListingApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/nft', network, ...options });
  }

  async listListedNftIds(ownerAddress: string): Promise<string[]> {
    const response = await this.makeJsonRequest(`/listed/${encodeURIComponent(ownerAddress)}/`);
    if (!Array.isArray(response?.results)) {
      throw new Error(`Unexpected listed NFT response: ${JSON.stringify(response)}`);
    }
    return response.results.map((id: unknown) => String(id));
  }
}
