import { Network } from '../constants';
import { AddressActivityPage, PaginatedResponse, Transaction } from '../types';
import { BaseApiClient, VfxApiError, orNullOn404 } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class TransactionApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/transaction', network: network, ...options });
  }

  /** One transaction by hash, or null when Spyglass has none (404). Other failures throw. */
  public getTransaction = async (hash: string): Promise<Transaction | null> => {
    return orNullOn404(() => this.makeJsonRequest(`/${encodeURIComponent(hash)}/`));
  };

  /**
   * Transactions to or from any of `addresses` (a main account and its vault,
   * say), newest first, in one list. Failures throw.
   */
  public listTransactionsForAddresses = async (
    addresses: string[],
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction>> => {
    if (addresses.length === 0) {
      throw new Error('listTransactionsForAddresses requires at least one address');
    }
    return this.makeJsonRequest(`/addresses/${addresses.map(encodeURIComponent).join(',')}/`, 'GET', { page, limit });
  };

  /**
   * Transactions to or from any of `addresses` (at most 20), newest first,
   * by cursor (`/transaction/activity/`): no count, and a new block does not
   * shift the next page. `limit` is 1 to 100 (Spyglass default 30); pass a
   * page's `nextCursor` as `before`. Resolves to null when Spyglass predates
   * the route (404); other failures throw.
   */
  public listActivity = async (
    addresses: string[],
    opts: { limit?: number; before?: string } = {},
  ): Promise<AddressActivityPage | null> => {
    const unique = [...new Set(addresses)];
    if (unique.length === 0 || unique.length > 20) {
      throw new Error(`listActivity takes 1 to 20 addresses, got ${unique.length}`);
    }
    if (opts.limit !== undefined && !(Number.isInteger(opts.limit) && opts.limit >= 1 && opts.limit <= 100)) {
      throw new Error(`listActivity: limit must be a whole number from 1 to 100, got ${opts.limit}`);
    }
    if (opts.before !== undefined && !/^\d+:.+$/.test(opts.before)) {
      throw new Error(`listActivity: before must be a cursor "<height>:<hash>", got ${opts.before}`);
    }
    let response: { results?: Transaction[]; next_cursor?: string | null };
    try {
      response = await this.makeJsonRequest('/activity/', 'GET', {
        addresses: unique.join(','),
        ...(opts.limit !== undefined && { limit: opts.limit }),
        ...(opts.before !== undefined && { before: opts.before }),
      });
    } catch (e) {
      if (e instanceof VfxApiError && e.status === 404) return null;
      throw e;
    }
    return { results: response?.results ?? [], nextCursor: response?.next_cursor ?? null };
  };

  /**
   * Transactions to or from `address`, newest first. Resolves to null on any
   * failure; pass `strict: true` to have failures throw instead, where an
   * outage must not read as "no transactions".
   */
  public listTransactionsForAddress = async (
    address: string,
    page = 1,
    limit = 10,
    opts: { strict?: boolean } = {},
  ): Promise<PaginatedResponse<Transaction> | null> => {
    try {
      return await this.makeJsonRequest(`/address/${encodeURIComponent(address)}/`, 'GET', {
        page: page,
        limit: limit,
      });
    } catch (e) {
      if (opts.strict) {
        throw e;
      }
      return null;
    }
  };
}
