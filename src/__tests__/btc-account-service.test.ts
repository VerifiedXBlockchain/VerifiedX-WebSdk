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
