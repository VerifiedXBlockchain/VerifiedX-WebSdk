import dotenv from 'dotenv';
import { VfxClient } from '../../index';
import { Network } from '../../constants';
import { RawTransactionApiClient } from '../../client/raw-transaction-api-client';
import { localTransactionFee } from '../../services/tx-build-session';

dotenv.config({ path: 'test.env' });

/**
 * Live-testnet checks for client-side transaction building. Opt-in only:
 *
 *   npm run test:integration
 *
 *   PRIVATE_KEY            funded testnet key (shared with the other suites)
 *   TO_ADDRESS             recipient for the sends
 *   RUN_HASH_MODE_SENDS    =1 to broadcast two 0.0001 VFX sends in 'local'
 *                          mode (the second uses the cached nonce). Without
 *                          it, each mode runs as a dryRun, which the node
 *                          verifies in full (hash, signature, fee, timestamp,
 *                          nonce) but does not send.
 */

jest.setTimeout(120_000);

const privateKey = process.env.PRIVATE_KEY;
const toAddress = process.env.TO_ADDRESS;
const describeFunded = privateKey && toAddress ? describe : describe.skip;

describeFunded('hash modes against the testnet node', () => {
  const keypairFor = (client: VfxClient) => ({
    privateKey: privateKey as string,
    publicKey: client.publicFromPrivate(privateKey as string),
    address: client.addressFromPrivate(privateKey as string),
  });

  test.each(['server', 'both', 'local'] as const)('the node verifies a %s-built send', async (hashMode) => {
    const client = new VfxClient(Network.Testnet, { dryRun: true, hashMode });
    const hash = await client.sendCoin(keypairFor(client), toAddress as string, 0.0001);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the local fee is never below the fee the node quotes', async () => {
    const client = new VfxClient(Network.Testnet, true);
    const from = keypairFor(client).address;
    const api = new RawTransactionApiClient(Network.Testnet);
    const shapes = [
      { TransactionType: 0, Amount: 1, Data: null },
      {
        TransactionType: 15,
        Amount: 0,
        Data: { Function: 'TokenTransfer()', ContractUID: 'x'.repeat(40), Amount: 1.5 },
      },
      {
        TransactionType: 26,
        Amount: 0,
        Data: { Function: 'TransferVBTCMultiV2()', Inputs: Array(10).fill({ SCUID: 'y'.repeat(50), Amount: 0.1 }) },
      },
    ];
    for (const shape of shapes) {
      const tx = {
        Hash: '',
        ToAddress: toAddress as string,
        FromAddress: from,
        Nonce: 1,
        Fee: 0,
        Timestamp: Math.floor(Date.now() / 1000),
        Signature: '',
        Height: 0,
        UnlockTime: null,
        ...shape,
      };
      const quoted = await api.getFee(tx);
      expect(localTransactionFee(tx)).toBeGreaterThanOrEqual(quoted);
    }
  });

  test("'local' sends twice, the second on the cached nonce", async () => {
    if (process.env.RUN_HASH_MODE_SENDS !== '1') {
      return;
    }
    const client = new VfxClient(Network.Testnet, { hashMode: 'local' });
    const first = await client.sendCoin(keypairFor(client), toAddress as string, 0.0001);
    const second = await client.sendCoin(keypairFor(client), toAddress as string, 0.0001);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });
});
