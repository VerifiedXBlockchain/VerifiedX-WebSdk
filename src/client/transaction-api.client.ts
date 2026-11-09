import { Network } from '../constants';
import { PaginatedResponse, Transaction } from '../types';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class TransactionApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/transaction', network: network, ...options });
  }

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
