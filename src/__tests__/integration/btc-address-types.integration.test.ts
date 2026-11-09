import BtcClient from '../../btc';
import { BtcSpendType } from '../../btc/address-types';

/**
 * Live signet spends from every non-default address type. Opt-in only:
 *
 *   BTC_TYPES_WIF=<signet WIF whose p2pkh, p2sh-p2wpkh, p2tr and p2tr-bip86
 *   addresses are funded> RUN_INTEGRATION=1 \
 *     npx jest --config jest.config.js src/__tests__/integration/btc-address-types.integration.test.ts
 *
 * Each address sends 1,000 sats to the key's own P2WPKH address. Testnet
 * only: BtcClient('testnet') is the VerifiedX signet.
 */

jest.setTimeout(120_000);

const wif = process.env.BTC_TYPES_WIF;

(wif ? describe : describe.skip)('spends from every address type on signet', () => {
  const client = new BtcClient('testnet');
  const p2wpkh = () => client.addressFromWif(wif as string).address as string;

  test.each(['p2pkh', 'p2sh-p2wpkh', 'p2tr', 'p2tr-bip86'] as BtcSpendType[])(
    '%s spends and the network accepts it',
    async (addressType) => {
      const txid = await client.sendBtc(wif as string, p2wpkh(), 0.00001, 2, { addressType });
      expect(txid).toMatch(/^[0-9a-f]{64}$/);
    },
  );
});
