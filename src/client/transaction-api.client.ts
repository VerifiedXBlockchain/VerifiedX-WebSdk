import { Network } from '../constants';
import { PaginatedResponse, Transaction } from '../types';
import { BaseApiClient, orNullOn404 } from './base-api-client';
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

  public listTransactionsForAddress = async (
    address: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction> | null> => {
    try {
      return await this.makeJsonRequest(`/address/${encodeURIComponent(address)}/`, 'GET', {
        page: page,
        limit: limit,
      });
    } catch (e) {
      return null;
    }
  };
}
