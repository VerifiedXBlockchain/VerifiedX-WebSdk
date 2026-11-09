import { Network } from '../constants';
import { BaseApiClient } from './base-api-client';
import { IApiClientOptions } from './address-api-client';

export class RawTransactionApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/raw', network: network, ...options });
  }

  async getTimestamp(): Promise<number> {
    const text = await this.makeTextRequest('/timestamp/', 'POST');
    return Number(text);
  }

  async getNonce(address: string): Promise<number> {
    const text = await this.makeTextRequest(`/nonce/${encodeURIComponent(address)}/`, 'POST');
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
    // Signatures are base64 and can contain '/', '+', '=' — percent-encode
    // every segment. Verified live (2026-07-07): the API accepts both raw
    // and encoded forms; encoded is the robust choice.
    return this.makeBoolRequest(
      `/validate-signature/${encodeURIComponent(message)}/${encodeURIComponent(address)}/${encodeURIComponent(
        signature,
      )}/`,
      'POST',
    );
  }

  async verifyTransaction(txData: Record<string, unknown>): Promise<boolean> {
    return (await this.verifyTransactionResult(txData)).valid;
  }

  /** The node's verdict on a transaction, with its reason when it refuses one. */
  async verifyTransactionResult(txData: Record<string, unknown>): Promise<{ valid: boolean; message: string | null }> {
    const params = { transaction: txData };
    const response = await this.makeJsonRequest('/verify/', 'POST', params);
    const valid = response?.Result === 'Success';
    const message = typeof response?.Message === 'string' && response.Message ? response.Message : null;
    return { valid, message: valid ? null : message };
  }

  /**
   * Compile a smart-contract payload on the node and return the transaction
   * Data for its deploy: `[{ Function, ContractUID, Data, MD5List }]`. The
   * node reports compile failures as a JSON object rather than the array, and
   * Spyglass turns those into a 500, so anything but the array shape is an
   * error here.
   */
  async getSmartContractDeployData(payload: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const response = await this.makeJsonRequest('/smart-contract-data/', 'POST', payload);
    if (!Array.isArray(response) || typeof response[0]?.ContractUID !== 'string') {
      throw new Error(`Unexpected smart-contract-data result: ${JSON.stringify(response)}`);
    }
    return response;
  }

  /** Transaction Data for an NFT transfer (Core GetNFTTransferData): `[{ Function: 'Transfer()', ... }]`. */
  async getNftTransferData(
    scIdentifier: string,
    toAddress: string,
    locator: string,
  ): Promise<Array<Record<string, unknown>>> {
    return this.nftData(
      `/nft-transfer-data/${encodeURIComponent(scIdentifier)}/${encodeURIComponent(toAddress)}/${encodeURIComponent(
        locator,
      )}/`,
      'nft-transfer-data',
    );
  }

  /** Transaction Data that sets an evolving NFT to `stage` (Core GetNFTEvolveData). */
  async getNftEvolveData(
    scIdentifier: string,
    toAddress: string,
    stage: number,
  ): Promise<Array<Record<string, unknown>>> {
    return this.nftData(
      `/nft-evolve-data/${encodeURIComponent(scIdentifier)}/${encodeURIComponent(toAddress)}/${stage}/`,
      'nft-evolve-data',
    );
  }

  /** Transaction Data for an NFT burn (Core GetNFTBurnData, which wraps it as a JSON string in `Message`). */
  async getNftBurnData(scIdentifier: string, fromAddress: string): Promise<Array<Record<string, unknown>>> {
    const response = await this.makeJsonRequest(
      `/nft-burn-data/${encodeURIComponent(scIdentifier)}/${encodeURIComponent(fromAddress)}/`,
      'POST',
    );
    if (response?.Success !== true || typeof response?.Message !== 'string') {
      throw new Error(`Unexpected nft-burn-data result: ${JSON.stringify(response)}`);
    }
    const data = JSON.parse(response.Message);
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected nft-burn-data Message: ${response.Message}`);
    }
    return data;
  }

  private async nftData(path: string, label: string): Promise<Array<Record<string, unknown>>> {
    const response = await this.makeJsonRequest(path, 'POST');
    // Core answers a refusal with an object ({ Success: false, Message }).
    if (!Array.isArray(response)) {
      throw new Error(`Unexpected ${label} result: ${JSON.stringify(response)}`);
    }
    return response;
  }

  /** The beacon locators last recorded for an NFT's media, or "NA" when it has none. */
  async getLocators(scIdentifier: string): Promise<string | null> {
    const response = await this.makeJsonRequest(`/locators/${encodeURIComponent(scIdentifier)}/`);
    return typeof response?.Locators === 'string' ? response.Locators : null;
  }

  /**
   * Ask the node to push an NFT's media to a beacon for `toAddress`, signed by
   * the owner over the contract id. Resolves to the beacon locator, or throws
   * with the node's reason.
   */
  async beaconUploadRequest(scIdentifier: string, toAddress: string, signature: string): Promise<string> {
    const response = await this.makeJsonRequest(
      `/beacon/upload/${encodeURIComponent(scIdentifier)}/${encodeURIComponent(toAddress)}/${encodeURIComponent(
        signature,
      )}/`,
    );
    if (response?.success !== true || typeof response?.locator !== 'string') {
      throw new Error(`Beacon upload request failed: ${JSON.stringify(response)}`);
    }
    return response.locator;
  }

  /**
   * Ask the node to fetch an NFT's media from the beacons in `locators` for
   * `address`, the new owner, signed by it over the contract id. Spyglass
   * refreshes the NFT's media URLs about 30 s after it succeeds. Throws when
   * the node refuses.
   */
  async beaconAssetsRequest(scIdentifier: string, locators: string, address: string, signature: string): Promise<void> {
    const response = await this.makeJsonRequest(
      `/beacon-assets/${[scIdentifier, locators, address, signature].map(encodeURIComponent).join('/')}/`,
    );
    if (response?.success !== true) {
      throw new Error(`Beacon assets request failed: ${JSON.stringify(response)}`);
    }
  }

  async sendTransaction(txData: Record<string, unknown>): Promise<boolean> {
    return (await this.sendTransactionResult(txData)).sent;
  }

  /** Send a signed transaction; the node's verdict, with its reason when it refuses. */
  async sendTransactionResult(txData: Record<string, unknown>): Promise<{ sent: boolean; message: string | null }> {
    const params = { transaction: txData };
    const response = await this.makeJsonRequest('/send/', 'POST', params);
    const sent = response?.Result === 'Success';
    const message = typeof response?.Message === 'string' && response.Message ? response.Message : null;
    return { sent, message: sent ? null : message };
  }
}
