import { Network } from '../constants';
import { PaginatedResponse, VbtcTransfer, VbtcV2Token, VbtcWithdrawalRequest } from '../types';
import { BaseApiClient } from './base-api-client';

export interface CeremonyPrepareResponse {
  success: boolean;
  ceremony_id: string;
  session_id: string;
  messages_to_sign: {
    start_message: string;
    start_timestamp: number;
    share_distribution_message: string;
    share_distribution_timestamp: number;
  };
  validator_count: number;
  threshold: number;
}

export interface CeremonyStatusResponse {
  success: boolean;
  status: string;
  progress?: number;
  message?: string;
}

export interface PreparedTransactionResponse {
  success: boolean;
  Hash: string;
  Fee?: number;
  SmartContractUID?: string;
  DepositAddress?: string;
  [key: string]: unknown;
}

export interface SentTransactionResponse {
  success: boolean;
  Hash: string;
  [key: string]: unknown;
}

export interface WithdrawCompletePrepareResponse {
  success: boolean;
  SessionId: string;
  StartMessage: string;
  StartTimestamp: number;
  ShareDistributionMessage: string;
  ShareDistributionTimestamp: number;
  Amount: number;
  BTCDestination: string;
  FeeRate: number;
}

export interface WithdrawCompleteExecuteResponse {
  success: boolean;
  job_id: string;
}

export type WithdrawCompleteStatusResponse =
  | { success: true; status: 'pending' }
  | {
      success: true;
      status: 'complete';
      signed_btc_tx_hex: string;
      sc_identifier: string;
      withdrawal_request_hash: string;
    }
  | { success: false; status: 'failed'; message: string };

export interface BroadcastResponse {
  success: boolean;
  txid: string;
}

interface SignedSendBody {
  hash: string;
  signature: string;
  public_key: string;
  [key: string]: unknown;
}

export class VbtcV2ApiClient extends BaseApiClient {
  constructor(network: Network) {
    super({ basePath: '/btc', network });
  }

  // Reads

  async listAllTokens(): Promise<VbtcV2Token[]> {
    const response: PaginatedResponse<VbtcV2Token> | { results: VbtcV2Token[] } =
      await this.makeJsonRequest('/vbtc-v2/');
    return response?.results ?? [];
  }

  async getTokensForAddress(address: string): Promise<VbtcV2Token[]> {
    const response: { results: VbtcV2Token[] } = await this.makeJsonRequest(`/vbtc-v2/${address}/`);
    return response?.results ?? [];
  }

  async getTokenDetail(scIdentifier: string): Promise<VbtcV2Token> {
    return this.makeJsonRequest(`/vbtc-v2/detail/${scIdentifier}/`);
  }

  async getTransfers(scIdentifier: string): Promise<VbtcTransfer[]> {
    const response: { results: VbtcTransfer[] } = await this.makeJsonRequest(
      `/vbtc-v2/transfers/${scIdentifier}/`,
    );
    return response?.results ?? [];
  }

  async getWithdrawals(scIdentifier: string): Promise<VbtcWithdrawalRequest[]> {
    const response: { results: VbtcWithdrawalRequest[] } = await this.makeJsonRequest(
      `/vbtc-v2/withdrawals/${scIdentifier}/`,
    );
    return response?.results ?? [];
  }

  // Ceremony

  async prepareCeremony(ownerAddress: string): Promise<CeremonyPrepareResponse> {
    return this.makeJsonRequest('/vbtc-v2/ceremony/prepare/', 'POST', { owner_address: ownerAddress });
  }

  async executeCeremony(body: {
    ceremony_id: string;
    session_id: string;
    owner_address: string;
    start_signature: string;
    start_timestamp: number;
    share_distribution_signature: string;
    share_distribution_timestamp: number;
  }): Promise<{ success: boolean }> {
    return this.makeJsonRequest('/vbtc-v2/ceremony/execute/', 'POST', body);
  }

  async getCeremonyStatus(ceremonyId: string): Promise<CeremonyStatusResponse> {
    return this.makeJsonRequest(`/vbtc-v2/ceremony/${ceremonyId}/`);
  }

  // Create

  async prepareCreate(body: {
    owner_address: string;
    name: string;
    description: string;
    ticker: string;
    ceremony_id: string;
    timestamp: number;
    unique_id: string;
    owner_signature: string;
  }): Promise<PreparedTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/create/prepare/', 'POST', body);
  }

  async sendCreate(body: SignedSendBody): Promise<SentTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/create/send/', 'POST', body);
  }

  // Transfer

  async prepareTransfer(body: {
    sc_identifier: string;
    from_address: string;
    to_address: string;
    amount: number;
  }): Promise<PreparedTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/transfer/prepare/', 'POST', body);
  }

  async sendTransfer(body: SignedSendBody): Promise<SentTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/transfer/send/', 'POST', body);
  }

  // Withdraw request (step 1)

  async prepareWithdrawRequest(body: {
    sc_identifier: string;
    requestor_address: string;
    btc_address: string;
    amount: number;
    fee_rate: number;
  }): Promise<PreparedTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/request/prepare/', 'POST', body);
  }

  async sendWithdrawRequest(body: SignedSendBody): Promise<SentTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/request/send/', 'POST', body);
  }

  // Withdraw complete (FROST) (step 2 + 3)

  async prepareWithdrawComplete(body: {
    sc_identifier: string;
    withdrawal_request_hash: string;
    owner_address: string;
  }): Promise<WithdrawCompletePrepareResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/complete/prepare/', 'POST', body);
  }

  async executeWithdrawComplete(body: {
    sc_identifier: string;
    withdrawal_request_hash: string;
    owner_address: string;
    session_id: string;
    start_signature: string;
    start_timestamp: number;
    share_distribution_signature: string;
    share_distribution_timestamp: number;
    amount: number;
    btc_destination: string;
    fee_rate: number;
  }): Promise<WithdrawCompleteExecuteResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/complete/execute/', 'POST', body);
  }

  async getWithdrawCompleteStatus(jobId: string): Promise<WithdrawCompleteStatusResponse> {
    return this.makeJsonRequest(`/vbtc-v2/withdraw/complete/status/${jobId}/`);
  }

  // Withdraw completion TX (step 4)

  async prepareWithdrawCompleteTx(body: {
    sc_identifier: string;
    from_address: string;
    withdrawal_request_hash: string;
    btc_transaction_hash: string;
    amount: number;
    btc_destination: string;
  }): Promise<PreparedTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/complete/tx/prepare/', 'POST', body);
  }

  async sendWithdrawCompleteTx(body: SignedSendBody): Promise<SentTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/complete/tx/send/', 'POST', body);
  }

  // Withdraw cancel

  async prepareWithdrawCancel(body: {
    sc_identifier: string;
    owner_address: string;
    withdrawal_request_hash: string;
  }): Promise<PreparedTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/cancel/prepare/', 'POST', body);
  }

  async sendWithdrawCancel(body: SignedSendBody): Promise<SentTransactionResponse> {
    return this.makeJsonRequest('/vbtc-v2/withdraw/cancel/send/', 'POST', body);
  }

  // Broadcast (BTC tx)

  async broadcastBtc(rawTxHex: string): Promise<BroadcastResponse> {
    return this.makeJsonRequest('/broadcast/', 'POST', { raw_tx_hex: rawTxHex });
  }
}
