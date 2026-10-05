import { Network } from '../constants';
import { FungibleToken, FungibleTokenDetail, PaginatedResponse, TokenVotingTopic } from '../types';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient } from './base-api-client';

/** Reads for fungible tokens as Spyglass indexes them. Failures throw VfxApiError. */
export class TokenApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/fungible-tokens', network, ...options });
  }

  async listTokens(page = 1, limit = 10): Promise<PaginatedResponse<FungibleToken>> {
    return this.makeJsonRequest('/', 'GET', { page, limit });
  }

  async getToken(scIdentifier: string): Promise<FungibleTokenDetail> {
    return this.makeJsonRequest(`/${encodeURIComponent(scIdentifier)}/`);
  }

  async listVotingTopics(scIdentifier: string, page = 1, limit = 10): Promise<PaginatedResponse<TokenVotingTopic>> {
    return this.makeJsonRequest(`/${encodeURIComponent(scIdentifier)}/voting-topics/`, 'GET', { page, limit });
  }

  async getVotingTopic(topicId: string): Promise<TokenVotingTopic> {
    return this.makeJsonRequest(`/voting-topics/${encodeURIComponent(topicId)}/`);
  }
}
