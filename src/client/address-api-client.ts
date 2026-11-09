import { Network } from '../constants';
import { AddressActivity, FungibleTokenBalance, VfxAddress } from '../types';
import { addressWithoutActivity, cleanAdnrName } from '../utils';
import { BaseApiClient, VfxApiError } from './base-api-client';

export interface IApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

/** Spyglass's cap on addresses per activity request. */
export const ADDRESS_ACTIVITY_MAX = 20;

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
          // Spyglass sends some balances as decimal strings (seen on a
          // recovered vault: "0.0000000000000000"); the type promises numbers.
          balance: Number(result.balance),
          balanceTotal: Number(result.balance_total),
          balanceLocked: Number(result.balance_locked ?? 0),
          adnr: result.adnr,
          activated: result.activated,
          deactivated: result.deactivated ?? false,
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
   *
   * The name is normalised first (see cleanAdnrName): `Name`, `name` and
   * `name.vfx` all check `name.vfx`, as the buy methods do.
   */
  public domainAvailable = async (domain: string, opts: { strict?: boolean } = {}): Promise<boolean> => {
    try {
      await this.makeJsonRequest(`/adnr/${encodeURIComponent(cleanAdnrName(domain))}/`);
      return false;
    } catch (e) {
      if (opts.strict && !isNotFound(e)) {
        throw e;
      }
      return true;
    }
  };

  /**
   * Every fungible token the address holds, with its balance. An address the
   * explorer has never seen (404) simply holds nothing; other failures throw.
   */
  public getTokenBalances = async (address: string): Promise<FungibleTokenBalance[]> => {
    try {
      const result: { tokens?: FungibleTokenBalance[] } = await this.makeJsonRequest(
        `/${encodeURIComponent(address)}/tokens/`,
      );
      return result?.tokens ?? [];
    } catch (e) {
      if (isNotFound(e)) {
        return [];
      }
      throw e;
    }
  };

  /**
   * Whether each address was ever used (`/addresses/activity/`), in the
   * order given, duplicates removed. At most 20 addresses. Resolves to null
   * when Spyglass predates the route (404); any other failure throws, never
   * reads as "no activity".
   */
  public getAddressesActivity = async (addresses: string[]): Promise<AddressActivity[] | null> => {
    const unique = [...new Set(addresses)];
    if (unique.length === 0 || unique.length > ADDRESS_ACTIVITY_MAX) {
      throw new Error(`getAddressesActivity takes 1 to ${ADDRESS_ACTIVITY_MAX} addresses, got ${unique.length}`);
    }
    let response: { results?: Array<Record<string, unknown>> };
    try {
      response = await this.makeJsonRequest('/activity/', 'GET', { addresses: unique.join(',') });
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
    const byAddress = new Map((response?.results ?? []).map((row) => [row.address as string, row]));
    return unique.map((address) => {
      const row = byAddress.get(address);
      if (!row) {
        throw new Error(`getAddressesActivity: Spyglass sent no row for ${address}`);
      }
      return {
        address,
        hasTransactions: row.has_transactions === true,
        hasBalance: row.has_balance === true,
        vaultActivated: row.vault_activated === true,
        registerRecoveryAddresses: Array.isArray(row.register_recovery_addresses)
          ? (row.register_recovery_addresses as string[])
          : [],
      };
    });
  };

  /** The address holding `domain`, normalised as in domainAvailable, or null. */
  public lookupDomain = async (domain: string, opts: { strict?: boolean } = {}): Promise<string | null> => {
    try {
      const result = await this.makeJsonRequest(`/adnr/${encodeURIComponent(cleanAdnrName(domain))}/`);
      return result?.address || null;
    } catch (e) {
      if (opts.strict && !isNotFound(e)) {
        throw e;
      }
      return null;
    }
  };
}
