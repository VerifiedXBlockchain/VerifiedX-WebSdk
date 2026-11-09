import EC from 'elliptic';
import { VfxClient } from '../index';
import { RawTransactionService } from '../services/raw-transaction-service';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { Signer, SigningIntent } from '../signer';
import { HashableTransaction, transactionHash } from '../services/transaction-hash';
import { CapturedCall, installFetch, textResponse } from './helpers/mock-fetch';

const curve = new EC.ec('secp256k1');
const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const RECIPIENT = 'xRecipient00000000000000000000000';

function installPipeline() {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': (_url: string, init?: RequestInit) => ({
      Result: 'Success',
      Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
    }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
  });
}

const sentFee = (calls: CapturedCall[]) =>
  (calls.find((c) => c.url.includes('/raw/send/'))?.body as { transaction: { Fee: number } }).transaction.Fee;
const feeCalls = (calls: CapturedCall[]) => calls.filter((c) => c.url.includes('/raw/fee/')).length;

function approvingSigner(intents: SigningIntent[]): Signer {
  return {
    address: keypair.address,
    publicKey: keypair.publicKey,
    approve: (intent) => {
      intents.push(intent);
    },
    signDigest: (digestHex: string) =>
      Uint8Array.from(
        curve
          .keyFromPrivate(Buffer.from(privateKey, 'hex'))
          .sign(Buffer.from(digestHex, 'hex'), { canonical: true })
          .toDER(),
      ),
  };
}

afterEach(() => jest.restoreAllMocks());

describe('the fee is known before approval and is the fee that is sent', () => {
  test.each(['both', 'local'] as const)(
    '%s: approve gets fee and total, computed locally, then used as-is',
    async (hashMode) => {
      const { calls } = installPipeline();
      const intents: SigningIntent[] = [];
      await new RawTransactionService({
        network: Network.Testnet,
        signer: approvingSigner(intents),
        toAddress: RECIPIENT,
        amount: 1.5,
        hashMode,
      }).process();
      const intent = intents[0];
      if (intent.action !== 'transaction') throw new Error('expected a transaction intent');
      expect(intent.fee).toBeGreaterThan(0.000003);
      expect(intent.total).toBe(Math.round((1.5 + (intent.fee as number)) * 1e8) / 1e8);
      expect(sentFee(calls)).toBe(intent.fee);
      expect(feeCalls(calls)).toBe(0);
    },
  );

  test('server mode with approve: one /raw/fee quote before approval, reused for the send', async () => {
    const { calls } = installPipeline();
    const intents: SigningIntent[] = [];
    const order: string[] = [];
    const signer = approvingSigner(intents);
    const approve = signer.approve as NonNullable<Signer['approve']>;
    signer.approve = (intent) => {
      order.push(`approve after ${calls.length} calls`);
      return approve(intent);
    };
    await new RawTransactionService({
      network: Network.Testnet,
      signer,
      toAddress: RECIPIENT,
      amount: 1,
      hashMode: 'server',
    }).process();
    expect(order).toEqual(['approve after 1 calls']);
    expect(calls[0].url).toContain('/raw/fee/');
    expect(feeCalls(calls)).toBe(1);
    expect(intents[0]).toMatchObject({ fee: 0.00025, total: 1.00025 });
    expect(sentFee(calls)).toBe(0.00025);
  });

  test('server mode without approve keeps the old order exactly', async () => {
    const { calls } = installPipeline();
    await new RawTransactionService({
      network: Network.Testnet,
      keypair,
      toAddress: RECIPIENT,
      amount: 1,
      hashMode: 'server',
    }).process();
    expect(calls.map((c) => c.url.split('/api')[1].split('/').slice(0, 3).join('/'))).toEqual([
      '/raw/timestamp',
      '/raw/nonce',
      '/raw/fee',
      '/raw/hash',
      '/raw/validate-signature',
      '/raw/verify',
      '/raw/send',
    ]);
  });

  test('quoteSendCoin equals the fee sendCoin sends, and the offline estimate is not below it', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet');
    const quote = await client.quoteSendCoin(keypair, RECIPIENT, 2.25);
    await client.sendCoin(keypair, RECIPIENT, 2.25);
    expect(sentFee(calls)).toBe(quote.fee);
    expect(quote.total).toBe(Math.round((2.25 + quote.fee) * 1e8) / 1e8);
    expect(
      client.estimateTransactionFee({ fromAddress: keypair.address, toAddress: RECIPIENT, amount: 2.25 }),
    ).toBeGreaterThanOrEqual(quote.fee);
  });
});
