import { Network } from '../constants';
import { PaginatedResponse, Transaction } from '../types';
import { BaseApiClient } from './base-api-client';

export class TransactionApiClient extends BaseApiClient {
  constructor(network: Network) {
    super({ basePath: '/transaction', network: network });
  }

  public listTransactionsForAddress = async (
    address: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction> | null> => {
    try {
      return await this.makeJsonRequest(`/address/${address}/`, 'GET', { page: page, limit: limit });
    } catch (e) {
      console.log(e);
      return null;
    }
  };
}
