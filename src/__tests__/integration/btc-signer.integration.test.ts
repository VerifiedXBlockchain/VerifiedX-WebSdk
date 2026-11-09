import * as bitcoin from 'bitcoinjs-lib';
import BtcClient from '../../btc';
import { btcSignerFromWif } from '../../btc/signer';

/**
 * Live signet send through the BtcSigner seam. Opt-in only:
 *
 *   BTC_SIGNER_WIF=<funded signet WIF> RUN_INTEGRATION=1 \
 *     npx jest --config jest.config.js src/__tests__/integration/btc-signer.integration.test.ts
 *
 * Sends 1,000 sats back to the key's own address (minus the fee), so it
 * needs only a little signet BTC. Testnet only: BtcClient('testnet') is
 * the VerifiedX signet.
 */

jest.setTimeout(120_000);

const wif = process.env.BTC_SIGNER_WIF;

(wif ? describe : describe.skip)('BtcSigner on signet', () => {
  test('sendBtc with a BtcSigner broadcasts a transaction the network accepts', async () => {
    const signer = btcSignerFromWif(wif as string, bitcoin.networks.testnet);
    const client = new BtcClient('testnet');
    const txid = await client.sendBtc(signer, signer.address, 0.00001);
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
  });
});
