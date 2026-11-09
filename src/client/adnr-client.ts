import { Network } from '../constants';
import { BaseApiClient, VfxApiError } from './base-api-client';
import { IApiClientOptions } from './address-api-client';
import { cleanAdnrName, cleanBtcDomain } from '../utils';
import { DomainAvailability } from '../types';

export class AdnrApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/adnr', network: network, ...options });
  }

  /**
   * The address a name points at, asking Spyglass for that field only
   * (`/adnr/<domain>/?fields=address`; an older Spyglass ignores the
   * parameter and sends the whole record). Null for an unknown or deleted
   * name (404); other failures throw.
   */
  public lookupDomainAddress = async (domain: string): Promise<string | null> => {
    try {
      const result = await this.makeJsonRequest(`/${encodeURIComponent(cleanAdnrName(domain))}/`, 'GET', {
        fields: 'address',
      });
      return result?.address || null;
    } catch (e) {
      if (e instanceof VfxApiError && e.status === 404) return null;
      throw e;
    }
  };

  /**
   * Whether a name can be bought (`/adnr/available/<domain>/`, uncached,
   * case-insensitive), normalised as in domainAvailable. Only an answer with
   * `available: true` means free. Resolves to null when Spyglass predates
   * the route (404); other failures throw.
   */
  public domainAvailability = async (domain: string): Promise<DomainAvailability | null> => {
    let result: { domain?: string; available?: unknown; indexed_height?: unknown };
    try {
      result = await this.makeJsonRequest(`/available/${encodeURIComponent(cleanAdnrName(domain))}/`);
    } catch (e) {
      if (e instanceof VfxApiError && e.status === 404) return null;
      throw e;
    }
    return {
      domain: result?.domain ?? cleanAdnrName(domain),
      available: result?.available === true,
      indexedHeight: Number(result?.indexed_height ?? 0),
    };
  };

  /** The BTC address a `.btc` name points at. `Name`, `name` and `name.btc` all look up `name.btc`. */
  public lookupBtcDomain = async (domain: string): Promise<string | null> => {
    try {
      const result = await this.makeJsonRequest(`/${encodeURIComponent(cleanBtcDomain(domain))}/`);
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
