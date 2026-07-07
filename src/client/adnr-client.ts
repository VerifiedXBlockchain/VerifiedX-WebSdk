import { Network } from '../constants';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class AdnrApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/adnr', network: network, ...options });
  }

  public lookupBtcDomain = async (domain: string): Promise<string | null> => {
    try {
      const result = await this.makeJsonRequest(`/${encodeURIComponent(domain)}/`);
      return result?.btc_address || null;
    } catch (e) {
      return null;
    }
  };

  public lookupBtcDomainFromBtcAddress = async (address: string): Promise<string | null> => {
    try {
      const result = await this.makeJsonRequest(`/btc/${encodeURIComponent(address)}/`);
      return result?.domain || null;
    } catch (e) {
      return null;
    }
  };
}
