import { Network } from '../constants';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient } from './base-api-client';

/** Spyglass session tokens, proved by a signature from the address. */
export class AuthApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/auth', network, ...options });
  }

  /** A one-hour token for `address`, given its signature over `message`. */
  async signToken(address: string, message: string, signature: string): Promise<{ token: string; expiresAt: string }> {
    const response = await this.makeJsonRequest('/sign-token/', 'POST', { address, message, signature });
    if (typeof response?.token !== 'string') {
      throw new Error(`Unexpected sign-token result: ${JSON.stringify(response)}`);
    }
    return { token: response.token, expiresAt: response.expires_at };
  }
}
