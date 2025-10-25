import { Network } from '../constants';
import { VbtcWithdrawalResult, VbtcWithdrawRequest } from '../types';
import { BaseApiClient } from './base-api-client';

export class RawTransactionApiClient extends BaseApiClient {
  constructor(network: Network) {
    super({ basePath: '/raw', network: network });
  }

  async getTimestamp(): Promise<number> {
    const text = await this.makeTextRequest('/timestamp/', 'POST');
    return Number(text);
  }

  async getNonce(address: string): Promise<number> {
    const text = await this.makeTextRequest(`/nonce/${address}/`, 'POST');
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
    return this.makeBoolRequest(`/validate-signature/${message}/${address}/${signature}/`, 'POST');
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

  async withdrawVbtc(payload: VbtcWithdrawRequest): Promise<VbtcWithdrawalResult> {
    const response = await this.makeJsonRequest('/withdraw-vbtc/', 'POST', payload);

    if (response?.result && response.result.Success === true) {
      const { Hash, UniqueId, SmartContractUID } = response.result;

      if (!Hash || !UniqueId || !SmartContractUID) {
        throw new Error(`Incomplete VBTC withdrawal response: ${JSON.stringify(response)}`);
      }

      return {
        txHash: Hash,
        uniqueId: UniqueId,
        scId: SmartContractUID,
      };
    }

    throw new Error(`VBTC withdrawal failed: ${JSON.stringify(response)}`);
  }
}
