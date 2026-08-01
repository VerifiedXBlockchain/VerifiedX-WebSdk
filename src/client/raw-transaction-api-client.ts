import { Network } from '../constants';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class RawTransactionApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/raw', network: network, ...options });
  }

  async getTimestamp(): Promise<number> {
    const text = await this.makeTextRequest('/timestamp/', 'POST');
    return Number(text);
  }

  async getNonce(address: string): Promise<number> {
    const text = await this.makeTextRequest(`/nonce/${encodeURIComponent(address)}/`, 'POST');
    return Number(text);
  }

  async getFee(txData: Record<string, unknown>): Promise<number> {
    const params = { transaction: txData };
    const response = await this.makeJsonRequest('/fee/', 'POST', params);

    if (response?.Result === 'Success' && response?.Fee != null) {
      return Number(response.Fee);
    }

    throw new Error(`Unexpected getFee() result: ${JSON.stringify(response)}`);
  }

  async getHash(txData: Record<string, unknown>): Promise<string> {
    const params = { transaction: txData };
    const response = await this.makeJsonRequest('/hash/', 'POST', params);

    if (response?.Result === 'Success' && response?.Hash != null) {
      return response.Hash;
    }

    throw new Error(`Unexpected getHash() result: ${JSON.stringify(response)}`);
  }

  async validateSignature(message: string, address: string, signature: string): Promise<boolean> {
    // Signatures are base64 and can contain '/', '+', '=' — percent-encode
    // every segment. Verified live (2026-07-07): the API accepts both raw
    // and encoded forms; encoded is the robust choice.
    return this.makeBoolRequest(
      `/validate-signature/${encodeURIComponent(message)}/${encodeURIComponent(address)}/${encodeURIComponent(
        signature,
      )}/`,
      'POST',
    );
  }

  async verifyTransaction(txData: Record<string, unknown>): Promise<boolean> {
    const params = { transaction: txData };
    const response = await this.makeJsonRequest('/verify/', 'POST', params);

    return response?.Result === 'Success';
  }

  async sendTransaction(txData: Record<string, unknown>): Promise<boolean> {
    const params = { transaction: txData };
    const response = await this.makeJsonRequest('/send/', 'POST', params);

    return response?.Result === 'Success';
  }
}
