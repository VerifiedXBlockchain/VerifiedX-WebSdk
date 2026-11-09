import { Network } from '../constants';
import { IApiClientOptions } from './address-api-client';
import { BaseApiClient } from './base-api-client';

export type PricedCoin = 'vfx' | 'btc';

/** The latest price Spyglass has for a coin (CoinMarketCap). */
export interface CoinPrice {
  coin_type: PricedCoin;
  usdt_price: number;
  volume_24h: number;
  percent_change_1h: number;
  percent_change_24h: number;
  last_updated: string;
}

/** One point of price history: USDT price and unix seconds. */
export interface CoinPricePoint {
  price: number;
  timestamp: number;
}

/** Coin prices from Spyglass (`/cmc-price/`). Failures throw VfxApiError. */
export class PriceApiClient extends BaseApiClient {
  constructor(network: Network, options: IApiClientOptions = {}) {
    super({ basePath: '/cmc-price', network, ...options });
  }

  async getPrice(coin: PricedCoin): Promise<CoinPrice> {
    const response = await this.makeJsonRequest(`/${coin}/`);
    if (response?.success !== true || !response.data) {
      throw new Error(`Unexpected price response for ${coin}: ${JSON.stringify(response)}`);
    }
    return response.data;
  }

  /** Up to the last 1,000 recorded prices, newest first. */
  async getPriceHistory(coin: PricedCoin): Promise<CoinPricePoint[]> {
    const response = await this.makeJsonRequest(`/${coin}/history/`);
    if (response?.success !== true || !Array.isArray(response.data)) {
      throw new Error(`Unexpected price history response for ${coin}: ${JSON.stringify(response)}`);
    }
    return response.data.map(([price, timestamp]: [number, number]) => ({ price, timestamp }));
  }
}
