import { VfxClient, VFX_API_BASE_URL_DEVNET, btc } from '../index';
import { installFetch } from './helpers/mock-fetch';

afterEach(() => jest.restoreAllMocks());

describe('recommendedFeeRates', () => {
  const table = { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 };

  test('floors testnet tiers like the Flutter wallet and passes mainnet through', async () => {
    installFetch({ '/v1/fees/recommended': () => table });
    expect(await btc.recommendedFeeRates('testnet')).toEqual({
      fastestFee: 10,
      halfHourFee: 8,
      hourFee: 5,
      economyFee: 5,
      minimumFee: 2,
      isEstimate: false,
    });
    expect(await btc.recommendedFeeRates('mainnet')).toEqual({ ...table, isEstimate: false });
  });

  test('falls back to the fixed table, marked as an estimate, when the API fails or answers nonsense', async () => {
    installFetch({ '/v1/fees/recommended': () => new Response('down', { status: 503 }) });
    expect(await btc.recommendedFeeRates('mainnet')).toEqual({ ...btc.BTC_FALLBACK_FEE_RATES, isEstimate: true });
    installFetch({ '/v1/fees/recommended': () => ({ fastestFee: 'lots' }) });
    expect((await btc.recommendedFeeRates('testnet')).isEstimate).toBe(true);
  });

  test('honours apiBaseUrl', async () => {
    const { calls } = installFetch({ '/v1/fees/recommended': () => table });
    await btc.recommendedFeeRates('mainnet', { apiBaseUrl: 'https://mempool.example/api' });
    expect(calls[0].url).toBe('https://mempool.example/api/v1/fees/recommended');
  });
});

describe('Greptile review fixes', () => {
  test('a stalled fee API yields the fallback after the timeout', async () => {
    // A server that accepts the request and never answers: fetch only ends
    // when the SDK aborts it.
    global.fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    ) as unknown as typeof fetch;
    const started = Date.now();
    const rates = await btc.recommendedFeeRates('mainnet', { timeoutMs: 50 });
    expect(rates.isEstimate).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('a complete table with a negative or zero tier is refused', async () => {
    installFetch({
      '/v1/fees/recommended': () => ({ fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: -1, minimumFee: 1 }),
    });
    expect(await btc.recommendedFeeRates('mainnet')).toEqual({ ...btc.BTC_FALLBACK_FEE_RATES, isEstimate: true });
    installFetch({
      '/v1/fees/recommended': () => ({ fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 0 }),
    });
    expect((await btc.recommendedFeeRates('mainnet')).isEstimate).toBe(true);
  });
});

describe('devnet', () => {
  test('a testnet client pointed at the devnet Spyglass reads from it', async () => {
    const { calls } = installFetch({ '/addresses/': () => ({ address: 'xA', balance: 0, balance_total: 0 }) });
    await new VfxClient('testnet', { baseUrl: VFX_API_BASE_URL_DEVNET }).getAddressDetails('xA');
    expect(calls[0].url.startsWith('https://data-devnet.verifiedx.io/api/')).toBe(true);
  });
});
