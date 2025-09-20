import { VfxClient, btc } from '../index';

describe('Namespace integration tests', () => {
  test('VfxClient should be available', () => {
    expect(VfxClient).toBeDefined();
    expect(typeof VfxClient).toBe('function');
  });

  test('btc namespace should be available', () => {
    expect(btc).toBeDefined();
    expect(btc.BtcClient).toBeDefined();
    expect(btc.KeypairService).toBeDefined();
    expect(btc.TransactionService).toBeDefined();
    expect(btc.AccountService).toBeDefined();
  });

  test('btc services should be constructable', () => {
    const keypairService = new btc.KeypairService(true); // testnet
    expect(keypairService).toBeDefined();

    const btcClient = new btc.BtcClient();
    expect(btcClient).toBeDefined();
  });

  test('both VFX and BTC should work together', () => {
    // VFX client
    const vfxClient = new VfxClient('testnet');
    expect(vfxClient).toBeDefined();

    // BTC client
    const btcClient = new btc.BtcClient();
    expect(btcClient).toBeDefined();

    // Both should coexist
    expect(vfxClient).not.toBe(btcClient);
  });
});