import EC from 'elliptic';
import { VfxClient } from '../index';
import { RawTransactionService } from '../services/raw-transaction-service';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { Signer, SigningBatchItem, SigningIntent, SigningRequest, sha256Hex } from '../signer';
import { hashPreimage, transactionHash, HashableTransaction } from '../services/transaction-hash';
import { installFetch, textResponse } from './helpers/mock-fetch';

const curve = new EC.ec('secp256k1');
const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const address = keypairService.addressFromPrivate(privateKey);
const publicKey = keypairService.publicFromPrivate(privateKey);
const RECIPIENT = 'xRecipient00000000000000000000000';

function derSign(digestHex: string): Uint8Array {
  return Uint8Array.from(
    curve
      .keyFromPrivate(Buffer.from(privateKey, 'hex'))
      .sign(Buffer.from(digestHex, 'hex'), { canonical: true })
      .toDER(),
  );
}

/** Answers `/raw/hash` with the hash the node computes, so 'both' mode agrees with it. */
const nodeHash = (_url: string, init?: RequestInit) => ({
  Result: 'Success',
  Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
});

function installRawPipeline(overrides: Record<string, (url: string, init?: RequestInit) => unknown> = {}) {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': nodeHash,
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
    ...overrides,
  });
}

const paths = (calls: Array<{ url: string }>) =>
  calls.map((c) => c.url.split('/api')[1].split('/').slice(0, 3).join('/'));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('backward compatibility: a one-argument signDigest', () => {
  // Written exactly as an integrator on 9.0.x wrote it: one parameter, no
  // signBatch, no approve. It must compile against today's Signer and sign
  // what a local key signs.
  const legacySigner: Signer = {
    address,
    publicKey,
    signDigest(digestHex: string): Uint8Array {
      return derSign(digestHex);
    },
  };

  test.each(['server', 'both', 'local'] as const)(
    'signs a send identically to the local key (%s)',
    async (hashMode) => {
      installRawPipeline();
      const spy = jest.spyOn(legacySigner, 'signDigest');
      const viaSigner = new RawTransactionService({
        network: Network.Testnet,
        signer: legacySigner,
        toAddress: RECIPIENT,
        amount: 1.5,
        hashMode,
      });
      const hash = await viaSigner.process();

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(sha256Hex(hash as string));
      const { calls } = installRawPipeline();
      await new RawTransactionService({
        network: Network.Testnet,
        keypair: { privateKey, publicKey, address },
        toAddress: RECIPIENT,
        amount: 1.5,
        hashMode,
      }).process();
      const sent = (calls.find((c) => c.url.includes('/raw/send/'))?.body as { transaction: { Signature: string } })
        .transaction.Signature;
      expect(sent).toBe(keypairService.getSignature(hash as string, privateKey));
    },
  );

  test('a vBTC transfer signs the prepared hash exactly as before', async () => {
    const { calls } = installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => ({ success: true, Hash: 'SENT' }),
    });
    await new VfxClient('testnet').transferVbtc({
      scIdentifier: 'sc-1',
      fromAddress: address,
      toAddress: RECIPIENT,
      amount: 1,
      signer: legacySigner,
    });
    const body = calls.find((c) => c.url.includes('/transfer/send/'))?.body as { signature: string };
    expect(body.signature).toBe(keypairService.getSignature('PREPARED_HASH', privateKey));
  });
});

describe('signing requests reach the signer', () => {
  function recordingSigner(extra: Partial<Signer> = {}) {
    const requests: SigningRequest[] = [];
    const signer: Signer = {
      address,
      publicKey,
      signDigest(digestHex: string, request?: SigningRequest) {
        if (!request) throw new Error('expected a request');
        // The digest is always SHA-256 of the message the request carries.
        expect(sha256Hex(request.message)).toBe(digestHex);
        requests.push(request);
        return derSign(digestHex);
      },
      ...extra,
    };
    return { signer, requests };
  }

  test('a send carries the transaction, its preimage and a flow id', async () => {
    installRawPipeline();
    const { signer, requests } = recordingSigner();
    const hash = await new RawTransactionService({
      network: Network.Testnet,
      signer,
      toAddress: RECIPIENT,
      amount: 2,
      data: { Function: 'Note()', Text: 'hi' },
    }).process();

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request.kind !== 'transaction') throw new Error('expected a transaction request');
    expect(request.hashSource).toBe('local');
    expect(request.transaction).toMatchObject({ FromAddress: address, ToAddress: RECIPIENT, Amount: 2, Nonce: 7 });
    expect(transactionHash(request.transaction)).toBe(hash);
    expect(hashPreimage(request.hashPreimage as string)).toBe(hash);
    expect(request.flowId).toMatch(/^[0-9a-f]{24}$/);
  });

  const ceremonyMocks = (prepared: Record<string, unknown> = {}) => ({
    '/btc/vbtc-v2/ceremony/prepare/': () => ({
      success: true,
      ceremony_id: 'CER_1',
      session_id: 'SES_1',
      messages_to_sign: {
        start_message: 'START_MSG',
        start_timestamp: 1700000000,
        share_distribution_message: 'SHARE_MSG',
        share_distribution_timestamp: 1700000001,
      },
      validator_count: 5,
      threshold: 3,
    }),
    '/btc/vbtc-v2/ceremony/execute/': () => ({ success: true }),
    '/btc/vbtc-v2/ceremony/CER_1/': () => ({ success: true, status: 'Completed', progress: 100 }),
    '/btc/vbtc-v2/create/prepare/': () => ({
      success: true,
      Hash: 'CREATE_HASH',
      SmartContractUID: 'SC_UID_1',
      DepositAddress: 'btcDeposit1',
      Fee: 2,
      ...prepared,
    }),
    '/btc/vbtc-v2/create/send/': () => ({ success: true, Hash: 'CREATE_TX_HASH' }),
  });
  const createParams = (signer: Signer) => ({
    ownerAddress: address,
    signer,
    name: 'MyToken',
    description: 'desc',
    ticker: 'MTK',
    pollIntervalMs: 1,
    timeoutMs: 2000,
  });

  test('a vault creation is one flow: ceremony start and share, ownership, then the transaction', async () => {
    installFetch(ceremonyMocks());
    const { signer, requests } = recordingSigner();
    await new VfxClient('testnet').createVbtcToken(createParams(signer));

    expect(requests.map((r) => [r.kind, 'step' in r ? r.step : undefined])).toEqual([
      ['vbtc-ceremony', 'start'],
      ['vbtc-ceremony', 'share'],
      ['vbtc-ownership', undefined],
      ['transaction', undefined],
    ]);
    expect(new Set(requests.map((r) => r.flowId)).size).toBe(1);
    expect(requests[0]).toMatchObject({ ceremonyId: 'CER_1', sessionId: 'SES_1', timestamp: 1700000000 });
    expect(requests[2]).toMatchObject({ name: 'MyToken', ticker: 'MTK', ceremonyId: 'CER_1' });
    expect(requests[3]).toMatchObject({ hashSource: 'prepared', message: 'CREATE_HASH' });
  });

  test('signBatch, when present, signs the ceremony pair in one call', async () => {
    installFetch(ceremonyMocks());
    const batches: SigningBatchItem[][] = [];
    const { signer, requests } = recordingSigner({
      async signBatch(items: SigningBatchItem[]) {
        batches.push(items);
        return items.map((item) => derSign(item.digestHex));
      },
    });
    await new VfxClient('testnet').createVbtcToken(createParams(signer));

    expect(batches).toHaveLength(1);
    expect(batches[0].map((item) => item.request.kind)).toEqual(['vbtc-ceremony', 'vbtc-ceremony']);
    expect(batches[0][0].digestHex).toBe(sha256Hex('START_MSG'));
    // The single signatures still go through signDigest.
    expect(requests.map((r) => r.kind)).toEqual(['vbtc-ownership', 'transaction']);
  });

  test('approve runs before the ceremony is prepared, and throwing from it cancels with no request made', async () => {
    const { calls } = installFetch(ceremonyMocks());
    const order: string[] = [];
    const intents: SigningIntent[] = [];
    const { signer } = recordingSigner({
      approve(intent: SigningIntent) {
        intents.push(intent);
        order.push(`approve:${calls.length}`);
      },
    });
    await new VfxClient('testnet').createVbtcToken(createParams(signer));
    expect(order).toEqual(['approve:0']);
    expect(intents[0]).toMatchObject({ action: 'vbtc-create', ownerAddress: address, ticker: 'MTK' });

    const refused = installFetch(ceremonyMocks());
    const { signer: refusing } = recordingSigner({
      approve() {
        throw new Error('user declined');
      },
    });
    await expect(new VfxClient('testnet').createVbtcToken(createParams(refusing))).rejects.toThrow('user declined');
    expect(refused.calls).toHaveLength(0);
  });

  test('approve is asked once per send, before the timestamp is read', async () => {
    const { calls } = installRawPipeline();
    const seen: number[] = [];
    const { signer } = recordingSigner({
      approve: () => {
        seen.push(calls.length);
      },
    });
    await new RawTransactionService({ network: Network.Testnet, signer, toAddress: RECIPIENT, amount: 1 }).process();
    expect(seen).toEqual([0]);
    await expect(
      new RawTransactionService({
        network: Network.Testnet,
        signer: {
          ...signer,
          approve: () => {
            throw new Error('declined');
          },
        },
        toAddress: RECIPIENT,
        amount: 1,
      }).process(),
    ).rejects.toThrow('declined');
  });

  test('a multi-input withdrawal signs start, share and each later input as one flow', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: true,
        SessionId: 'SES_W',
        StartMessage: 'FROST_START',
        StartTimestamp: 100,
        ShareDistributionMessage: 'FROST_SHARE',
        ShareDistributionTimestamp: 101,
        StartMessages: [
          { InputIndex: 0, SessionId: 'SES_W', Message: 'FROST_START', Timestamp: 100 },
          { InputIndex: 1, SessionId: 'SES_W1', Message: 'FROST_START_1', Timestamp: 102 },
        ],
        Amount: 0.001,
        BTCDestination: 'bc1qBTC',
        FeeRate: 10,
      }),
      '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_F' }),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_F/': () => ({
        success: true,
        status: 'complete',
        signed_btc_tx_hex: 'DEADBEEF',
        sc_identifier: 'sc-1',
        withdrawal_request_hash: 'WR_HASH',
      }),
      '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID' }),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: true, Hash: 'CP', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/complete/tx/send/': () => ({ success: true, Hash: 'COMPLETION_HASH' }),
    });
    const { signer, requests } = recordingSigner();
    await new VfxClient('testnet').completeWithdrawal({
      scIdentifier: 'sc-1',
      requestorAddress: address,
      withdrawalRequestHash: 'WR_HASH',
      btcAddress: 'bc1qBTC',
      amount: 0.001,
      feeRate: 10,
      signer,
      pollIntervalMs: 1,
      timeoutMs: 2000,
    });

    const frost = requests.filter((r) => r.kind === 'frost-withdrawal');
    expect(frost.map((r) => ('step' in r ? r.step : ''))).toEqual(['start', 'share', 'input']);
    expect(frost[2]).toMatchObject({ inputIndex: 1, sessionId: 'SES_W1', message: 'FROST_START_1' });
    expect(new Set(frost.map((r) => r.flowId)).size).toBe(1);
  });

  test("a prepared transaction whose HashPreimage does not hash to its Hash is refused unless hashMode is 'server'", async () => {
    const preimage = 'PREIMAGE_TEXT';
    installFetch(ceremonyMocks({ HashPreimage: preimage, Hash: 'NOT_THE_HASH' }));
    const { signer } = recordingSigner();
    await expect(new VfxClient('testnet').createVbtcToken(createParams(signer))).rejects.toMatchObject({
      name: 'TransactionHashMismatchError',
    });

    installFetch(ceremonyMocks({ HashPreimage: preimage, Hash: hashPreimage(preimage) }));
    const { signer: ok, requests } = recordingSigner();
    await new VfxClient('testnet').createVbtcToken(createParams(ok));
    expect(requests[3]).toMatchObject({ kind: 'transaction', hashPreimage: preimage });

    installFetch(ceremonyMocks({ HashPreimage: preimage, Hash: 'NOT_THE_HASH' }));
    await expect(
      new VfxClient('testnet', { hashMode: 'server' }).createVbtcToken(createParams(recordingSigner().signer)),
    ).resolves.toMatchObject({ transactionHash: 'CREATE_TX_HASH' });
  });
});

describe('signMessage', () => {
  test('a keypair signs exactly as getSignature does, and a signer gets a message request', async () => {
    const client = new VfxClient('testnet');
    expect(await client.signMessage({ privateKey }, 'hello')).toBe(client.getSignature('hello', privateKey));

    const requests: SigningRequest[] = [];
    const signature = await client.signMessage(
      {
        address,
        publicKey,
        signDigest: (digestHex: string, request?: SigningRequest) => {
          requests.push(request as SigningRequest);
          return derSign(digestHex);
        },
      },
      'hello',
    );
    expect(signature).toBe(client.getSignature('hello', privateKey));
    expect(requests).toEqual([expect.objectContaining({ kind: 'message', message: 'hello' })]);
    expect(client.verifySignature('hello', signature, address)).toBe(true);
  });
});

describe('RawTransactionService hash modes', () => {
  const keypair = { privateKey, publicKey, address };

  test("'both' builds locally, checks /raw/hash, and skips fee and validate-signature", async () => {
    const { calls } = installRawPipeline();
    const hash = await new RawTransactionService({
      network: Network.Testnet,
      keypair,
      toAddress: RECIPIENT,
      amount: 1,
    }).process();
    expect(paths(calls)).toEqual(['/raw/timestamp', '/raw/nonce', '/raw/hash', '/raw/verify', '/raw/send']);
    const sent = (calls[4].body as { transaction: HashableTransaction & { Hash: string } }).transaction;
    expect(sent.Hash).toBe(hash);
    expect(transactionHash(sent)).toBe(hash);
    expect(sent.Fee).toBeGreaterThan(0.000003);
  });

  test("'both' refuses to sign when the server's hash differs", async () => {
    const { calls } = installRawPipeline({
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'SERVER_SAYS_OTHERWISE' }),
    });
    const signDigest = jest.fn(derSign);
    await expect(
      new RawTransactionService({
        network: Network.Testnet,
        signer: { address, publicKey, signDigest },
        toAddress: RECIPIENT,
        amount: 1,
      }).process(),
    ).rejects.toMatchObject({ name: 'TransactionHashMismatchError', serverHash: 'SERVER_SAYS_OTHERWISE' });
    expect(signDigest).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });

  test("'local' needs only the nonce and the send, and a warm session needs only the send", async () => {
    const { calls } = installRawPipeline();
    const client = new VfxClient('testnet', { hashMode: 'local' });
    const first = await client.sendCoin({ privateKey, publicKey, address }, RECIPIENT, 1);
    expect(paths(calls)).toEqual(['/raw/timestamp', '/raw/nonce', '/raw/send']);

    calls.length = 0;
    const second = await client.sendCoin({ privateKey, publicKey, address }, RECIPIENT, 1);
    expect(paths(calls)).toEqual(['/raw/send']);
    expect(second).not.toBe(first);
    expect((calls[0].body as { transaction: { Nonce: number } }).transaction.Nonce).toBe(8);
  });

  test("'local' with preflight still asks the node to verify", async () => {
    const { calls } = installRawPipeline();
    await new RawTransactionService({
      network: Network.Testnet,
      keypair,
      toAddress: RECIPIENT,
      amount: 1,
      hashMode: 'local',
      preflight: true,
    }).process();
    expect(paths(calls)).toEqual(['/raw/timestamp', '/raw/nonce', '/raw/verify', '/raw/send']);
  });

  test('privacy types fall back to the server hash', async () => {
    const { calls } = installRawPipeline({ '/raw/hash/': () => ({ Result: 'Success', Hash: 'PRIVATE_HASH' }) });
    const hash = await new RawTransactionService({
      network: Network.Testnet,
      keypair,
      toAddress: RECIPIENT,
      amount: 1,
      txType: 31,
    }).process();
    expect(hash).toBe('PRIVATE_HASH');
    expect(paths(calls)).toContain('/raw/fee');
  });
});
