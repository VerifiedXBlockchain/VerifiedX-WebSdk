import { Network } from '../constants';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient, orNullOn404 } from './base-api-client';
import { VfxBlock } from '../types';

export class BlockApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/blocks', network, ...options });
  }

  /** The newest block Spyglass has indexed. */
  async getLatestBlock(): Promise<VfxBlock> {
    const response: { results?: VfxBlock[] } = await this.makeJsonRequest('/', 'GET', { limit: 1 });
    const block = response?.results?.[0];
    if (!block || typeof block.height !== 'number') {
      throw new Error(`Unexpected block list response: ${JSON.stringify(response)}`);
    }
    return block;
  }

  /** The block at `height`, or null when Spyglass has none (404). Other failures throw. */
  async getBlock(height: number): Promise<VfxBlock | null> {
    return orNullOn404(() => this.makeJsonRequest(`/${height}/`));
  }

  /** The block with this hash, or null when Spyglass has none (404). */
  async getBlockByHash(hash: string): Promise<VfxBlock | null> {
    return orNullOn404(() => this.makeJsonRequest(`/hash/${encodeURIComponent(hash)}/`));
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
