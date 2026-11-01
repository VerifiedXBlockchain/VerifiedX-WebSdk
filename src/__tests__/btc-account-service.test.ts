import AccountService from '../btc/account';
import { installFetch } from './helpers/mock-fetch';

const service = new AccountService(true);

afterEach(() => {
  jest.resetAllMocks();
});

describe('addressInfo', () => {
  const chainStats = {
    funded_txo_sum: 150_000,
    spent_txo_sum: 40_000,
    tx_count: 12,
  };

  test('returns satoshi totals by default', async () => {
    installFetch({ '/api/address/tb1qtest': () => ({ chain_stats: chainStats }) });

    const info = await service.addressInfo('tb1qtest');
    expect(info).toEqual({
      totalRecieved: 150_000,
      totalSent: 40_000,
      balance: 110_000,
      txCount: 12,
    });
  });

  test('converts to BTC when inSatoshis=false', async () => {
    installFetch({ '/api/address/tb1qtest': () => ({ chain_stats: chainStats }) });

    const info = await service.addressInfo('tb1qtest', false);
    expect(info.totalRecieved).toBeCloseTo(0.0015);
    expect(info.totalSent).toBeCloseTo(0.0004);
    expect(info.balance).toBeCloseTo(0.0011);
  });

  test('uses the VerifiedX signet API on testnet', async () => {
    const { calls } = installFetch({ '/api/address/': () => ({ chain_stats: chainStats }) });
    await service.addressInfo('tb1qtest');
    expect(calls[0].url).toBe('https://signet.verifiedx.io/api/address/tb1qtest');
  });

  test('uses mempool.space on mainnet', async () => {
    const { calls } = installFetch({ '/api/address/': () => ({ chain_stats: chainStats }) });
    await new AccountService(false).addressInfo('bc1qtest');
    expect(calls[0].url).toBe('https://mempool.space/api/address/bc1qtest');
  });

  test('an explicit apiBaseUrl wins over the default', async () => {
    const { calls } = installFetch({ '/api/address/': () => ({ chain_stats: chainStats }) });
    await new AccountService(true, 'https://example.test/api').addressInfo('tb1qtest');
    expect(calls[0].url).toBe('https://example.test/api/address/tb1qtest');
  });
});

describe('transactions', () => {
  test('returns the parsed transaction list', async () => {
    const fakeTxs = [
      {
        txid: 'ab'.repeat(32),
        version: 2,
        locktime: 0,
        vin: [],
        vout: [],
        size: 200,
        weight: 500,
        fee: 300,
        status: { confirmed: true, block_height: 1, block_hash: 'x', block_time: 1 },
      },
    ];
    installFetch({ '/txs': () => fakeTxs });

    const txs = await service.transactions('tb1qtest');
    expect(txs).toHaveLength(1);
    expect(txs[0].txid).toBe('ab'.repeat(32));
  });
});

describe('transactions', () => {
  const tx = (id: string, confirmed = true) => ({ txid: id, status: { confirmed } });
  const page = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => tx(`${prefix}${i}`));

  test('first page comes from /txs and is cut to limit', async () => {
    const { calls } = installFetch({ '/address/tb1qa/txs': () => page('c', 25) });
    const txs = await service.transactions('tb1qa', 10);
    expect(txs).toHaveLength(10);
    expect(calls.map((c) => c.url)).toEqual(['https://signet.verifiedx.io/api/address/tb1qa/txs']);
  });

  test('pages /txs/chain/{lastConfirmedTxid} until limit is reached', async () => {
    const { calls } = installFetch({
      '/txs/chain/c24': () => page('d', 25),
      '/address/tb1qa/txs': () => [tx('m0', false), ...page('c', 25)],
    });
    const txs = await service.transactions('tb1qa', 40);
    expect(txs).toHaveLength(40);
    expect(txs[0].txid).toBe('m0');
    expect(txs[39].txid).toBe('d13');
    expect(calls.map((c) => c.url)).toEqual([
      'https://signet.verifiedx.io/api/address/tb1qa/txs',
      'https://signet.verifiedx.io/api/address/tb1qa/txs/chain/c24',
    ]);
  });

  test('stops when a page is short', async () => {
    const { calls } = installFetch({ '/address/tb1qa/txs': () => page('c', 3) });
    const txs = await service.transactions('tb1qa', 50);
    expect(txs).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  test('before starts from /txs/chain/{before}', async () => {
    const { calls } = installFetch({ '/txs/chain/seen': () => page('o', 5) });
    const txs = await service.transactions('tb1qa', 50, 'seen');
    expect(txs.map((t) => t.txid)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
    expect(calls[0].url).toBe('https://signet.verifiedx.io/api/address/tb1qa/txs/chain/seen');
  });

  test('rejects a non-positive limit', async () => {
    installFetch({});
    await expect(service.transactions('tb1qa', 0)).rejects.toThrow('limit must be a positive integer');
  });
});
