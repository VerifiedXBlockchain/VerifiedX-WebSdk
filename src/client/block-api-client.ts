import { Network } from '../constants';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient } from './base-api-client';

export class BlockApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/blocks', network, ...options });
  }

  /** Height of the newest block Spyglass has indexed. */
  async getLatestHeight(): Promise<number> {
    const response: { results?: Array<{ height: number }> } = await this.makeJsonRequest('/', 'GET', { limit: 1 });
    const height = response?.results?.[0]?.height;
    if (typeof height !== 'number') {
      throw new Error(`Unexpected block list response: ${JSON.stringify(response)}`);
    }
    return height;
  }
}
