import { VfxClient } from '../index';
import { installFetch, jsonResponse } from './helpers/mock-fetch';

const path = (url: string) => url.split('/api')[1];

afterEach(() => jest.restoreAllMocks());

describe('VfxClient reads', () => {
  test('getTransaction returns the transaction, null on 404, and throws on an outage', async () => {
    const { calls } = installFetch({
      '/transaction/HASH_OK/': () => ({ hash: 'HASH_OK', height: 5 }),
      '/transaction/HASH_GONE/': () => jsonResponse({ detail: 'Not found.' }, 404),
      '/transaction/HASH_DOWN/': () => jsonResponse({}, 502),
    });
    const client = new VfxClient('testnet');
    expect(await client.getTransaction('HASH_OK')).toMatchObject({ hash: 'HASH_OK' });
    expect(await client.getTransaction('HASH_GONE')).toBeNull();
    await expect(client.getTransaction('HASH_DOWN')).rejects.toMatchObject({ name: 'VfxApiError', status: 502 });
    expect(path(calls[0].url)).toBe('/transaction/HASH_OK/');
  });

  test('listTransactionsForAddresses joins the addresses into one list request', async () => {
    const { calls } = installFetch({
      '/transaction/addresses/': () => ({ count: 0, page: 2, num_pages: 1, results: [] }),
    });
    await new VfxClient('testnet').listTransactionsForAddresses(['xA', 'xRBXB'], 2, 25);
    expect(path(calls[0].url)).toBe('/transaction/addresses/xA,xRBXB/?page=2&limit=25');
    await expect(new VfxClient('testnet').listTransactionsForAddresses([])).rejects.toThrow(/at least one/);
  });

  test('latest block, block by height and by hash', async () => {
    const block = { height: 42, hash: 'BH', previous_hash: 'P', validator_address: 'xV' };
    const { calls } = installFetch({
      '/blocks/?limit=1': () => ({ count: 1, page: 1, num_pages: 1, results: [block] }),
      '/blocks/42/': () => block,
      '/blocks/43/': () => jsonResponse({ detail: 'Not found.' }, 404),
      '/blocks/hash/BH/': () => block,
    });
    const client = new VfxClient('testnet');
    expect(await client.getLatestBlock()).toEqual(block);
    expect(await client.getLatestBlockHeight()).toBe(42);
    expect(await client.getBlock(42)).toEqual(block);
    expect(await client.getBlock(43)).toBeNull();
    expect(await client.getBlockByHash('BH')).toEqual(block);
    expect(calls.map((c) => path(c.url))).toContain('/blocks/hash/BH/');
  });

  test('coin price and history', async () => {
    installFetch({
      '/cmc-price/vfx/history/': () => ({
        success: true,
        data: [
          [37.5, 1785331909.045],
          [37.4, 1785331603.044],
        ],
      }),
      '/cmc-price/btc/': () => ({
        success: true,
        data: {
          coin_type: 'btc',
          usdt_price: 90000,
          volume_24h: 1,
          percent_change_1h: 0,
          percent_change_24h: 0,
          last_updated: 't',
        },
      }),
      '/cmc-price/vfx/': () => ({ success: false, message: 'nope' }),
    });
    const client = new VfxClient('mainnet');
    expect((await client.getCoinPrice('btc')).usdt_price).toBe(90000);
    expect(await client.getCoinPriceHistory()).toEqual([
      { price: 37.5, timestamp: 1785331909.045 },
      { price: 37.4, timestamp: 1785331603.044 },
    ]);
    await expect(client.getCoinPrice()).rejects.toThrow(/Unexpected price response/);
  });

  test('listed NFT ids for an owner', async () => {
    const { calls } = installFetch({ '/nft/listed/': () => ({ results: ['sc1:1', 'sc2:2'] }) });
    expect(await new VfxClient('testnet').listListedNftIds('xOwner')).toEqual(['sc1:1', 'sc2:2']);
    expect(path(calls[0].url)).toBe('/nft/listed/xOwner/');
  });
});
