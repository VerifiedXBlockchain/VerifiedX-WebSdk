import { Network } from '../constants';
import { PaginatedResponse, Transaction } from '../types';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class TransactionApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/transaction', network: network, ...options });
  }

  public listTransactionsForAddress = async (
    address: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction> | null> => {
    try {
      return await this.makeJsonRequest(`/address/${encodeURIComponent(address)}/`, 'GET', { page: page, limit: limit });
    } catch (e) {
      return null;
    }
  };
}
