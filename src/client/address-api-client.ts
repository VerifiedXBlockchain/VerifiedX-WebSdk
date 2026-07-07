import { Network } from '../constants';
import { VfxAddress } from '../types';
import { addressWithoutActivity } from '../utils';
import { BaseApiClient, VfxApiError } from './base-api-client';

export interface IApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

function isNotFound(e: unknown): boolean {
  return e instanceof VfxApiError && e.status === 404;
}

export class AddressApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/addresses', network: network, ...options });
  }

  /**
   * Fetch address details. By default any failure (including the API being
   * unreachable) resolves to the zero-activity shape, preserving the
   * historical contract. Pass `strict: true` to only map a genuine 404 to
   * the zero-activity shape and rethrow transport/server errors — use this
   * when a stale "balance: 0" would be worse than an exception.
   */
  public getAddressDetails = async (address: string, opts: { strict?: boolean } = {}): Promise<VfxAddress | null> => {
    try {
      const result = await this.makeJsonRequest(`/${address}`);

      if (result) {
        return {
          address: result.address,
          balance: result.balance,
          balanceTotal: result.balance_total,
          balanceLocked: result.balance_locked,
          adnr: result.adnr,
          activated: result.activated,
        };
      }

      return addressWithoutActivity(address);
    } catch (e) {
      if (opts.strict && !isNotFound(e)) {
        throw e;
      }
      return addressWithoutActivity(address);
    }
  };

  /**
   * By default any failure reads as "available" (historical contract).
   * Pass `strict: true` to treat only a 404 as available and rethrow
   * transport/server errors — REQUIRED when a purchase decision follows,
   * otherwise an outage looks like a free domain.
   */
  public domainAvailable = async (domain: string, opts: { strict?: boolean } = {}): Promise<boolean> => {
    try {
      await this.makeJsonRequest(`/adnr/${encodeURIComponent(domain)}/`);
      return false;
    } catch (e) {
      if (opts.strict && !isNotFound(e)) {
        throw e;
      }
      return true;
    }
  };

  public lookupDomain = async (domain: string, opts: { strict?: boolean } = {}): Promise<string | null> => {
    try {
      const result = await this.makeJsonRequest(`/adnr/${encodeURIComponent(domain)}/`);
      return result?.address || null;
    } catch (e) {
      if (opts.strict && !isNotFound(e)) {
        throw e;
      }
      return null;
    }
  };
}
