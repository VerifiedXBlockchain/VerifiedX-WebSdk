import * as bitcoin from 'bitcoinjs-lib';
import { SATOSHI_TO_BTC_MULTIPLIER, defaultApiBaseUrl } from './constants';

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;

// Esplora returns confirmed history in pages of 25; a shorter page is the last.
const ESPLORA_CHAIN_PAGE_SIZE = 25;

interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  vin: any[]; // You can replace `any[]` with a more specific type if needed
  vout: any[]; // You can replace `any[]` with a more specific type if needed
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
}

export default class AccountService {
  network: bitcoin.Network;
  apiBaseUrl: string;

  constructor(isTestnet: boolean, apiBaseUrl?: string) {
    this.network = isTestnet ? TESTNET : MAINNET;
    this.apiBaseUrl = apiBaseUrl ?? defaultApiBaseUrl(isTestnet);
  }

  public async addressInfo(address: string, inSatoshis = true) {
    const url = `${this.apiBaseUrl}/address/${address}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching address info: ${response.status}`);
    }
    const result = await response.json();

    const data = result['chain_stats'];
    if (!data) {
      throw new Error('Unexpected address info response: missing chain_stats');
    }

    const totalRecieved = inSatoshis ? data.funded_txo_sum : data.funded_txo_sum * SATOSHI_TO_BTC_MULTIPLIER;
    const totalSent = inSatoshis ? data.spent_txo_sum : data.spent_txo_sum * SATOSHI_TO_BTC_MULTIPLIER;

    return {
      totalRecieved: totalRecieved,
      totalSent: totalSent,
      balance: totalRecieved - totalSent,
      txCount: data.tx_count,
    };
  }

  /**
   * Newest-first transaction history, at most `limit` entries.
   *
   * Without `before`, the first page is Esplora's `/address/{a}/txs`
   * (unconfirmed transactions, then the newest confirmed ones). With
   * `before` (a txid already seen), it starts from
   * `/address/{a}/txs/chain/{before}`: confirmed transactions older than that
   * one, no mempool entries. Further `/txs/chain/{lastConfirmedTxid}` pages
   * are fetched until `limit` is reached or the history runs out. To page,
   * pass the last returned confirmed txid as the next call's `before`.
   */
  public async transactions(address: string, limit = 50, before: string | null = null): Promise<Transaction[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`limit must be a positive integer, got ${limit}`);
    }

    const results: Transaction[] = [];
    let path = before ? `/address/${address}/txs/chain/${before}` : `/address/${address}/txs`;

    while (results.length < limit) {
      const page = await this.fetchTransactionPage(path);
      results.push(...page);

      const confirmed = page.filter((tx) => tx.status?.confirmed);
      if (confirmed.length < ESPLORA_CHAIN_PAGE_SIZE) break;
      path = `/address/${address}/txs/chain/${confirmed[confirmed.length - 1].txid}`;
    }

    return results.slice(0, limit);
  }

  private async fetchTransactionPage(path: string): Promise<Transaction[]> {
    const response = await fetch(`${this.apiBaseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Error fetching transactions: ${response.status}`);
    }
    return response.json();
  }
}
