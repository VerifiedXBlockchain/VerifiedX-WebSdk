import crypto from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import BtcClient from '../btc';
import TransactionService from '../btc/transaction';
import { BtcSigner, BtcSigningIntent, BtcSigningRequest, btcSignerFromWif } from '../btc/signer';
import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { encodeDerSignature, parseDerSignature, derSignatureToBytes } from '../signer';
import { CapturedCall, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const ECPair = ECPairFactory(ecc);
const TESTNET = bitcoin.networks.testnet;
const SENDER_WIF = 'cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M';
const OTHER_WIF = ECPair.fromPrivateKey(crypto.createHash('sha256').update('other-btc-key').digest(), {
  network: TESTNET,
}).toWIF();
const RECIPIENT = bitcoin.payments.p2wpkh({
  pubkey: ECPair.fromPrivateKey(crypto.createHash('sha256').update('btc-signer-recipient').digest()).publicKey,
  network: TESTNET,
}).address as string;
const FAKE_TXID = 'aa'.repeat(32);
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

function installUtxoFetch(utxoValues: number[]): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/utxo')) {
      return new Response(
        JSON.stringify(
          utxoValues.map((value, i) => ({ txid: FAKE_TXID, vout: i, value, status: { confirmed: true } })),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/fees/recommended')) {
      return new Response(
        JSON.stringify({ fastestFee: 30, halfHourFee: 20, hourFee: 10, economyFee: 7, minimumFee: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`No mock for URL: ${url}`);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

const service = new TransactionService(true);

/** A BtcSigner that records its calls and delegates to a local key. */
function recording(wif = SENDER_WIF, overrides: Partial<BtcSigner> = {}) {
  const base = btcSignerFromWif(wif, TESTNET);
  const requests: BtcSigningRequest[] = [];
  const intents: BtcSigningIntent[] = [];
  const signer: BtcSigner = {
    ...base,
    signPsbt: (psbt: string, request?: BtcSigningRequest) => {
      requests.push(request as BtcSigningRequest);
      return base.signPsbt(psbt, request);
    },
    signDigest: (digest: string, request?: BtcSigningRequest) => {
      requests.push(request as BtcSigningRequest);
      return (base.signDigest as NonNullable<BtcSigner['signDigest']>)(digest, request);
    },
    approve: (intent) => {
      intents.push(intent);
    },
    ...overrides,
  };
  return { signer, requests, intents };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createTransactionWithSigner', () => {
  test('produces exactly the transaction the WIF path produces, and tells the signer what it signs', async () => {
    installUtxoFetch([100_000, 40_000]);
    const fromWif = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, 10);
    installUtxoFetch([100_000, 40_000]);
    const { signer, requests, intents } = recording();
    const fromSigner = await service.createTransactionWithSigner(signer, RECIPIENT, 0.0005, 10);

    expect(fromSigner).toEqual(fromWif);
    expect(fromSigner.success).toBe(true);
    expect(intents).toEqual([
      expect.objectContaining({ action: 'btc-send', toAddress: RECIPIENT, amountSats: 50_000 }),
    ]);
    const request = requests[0];
    if (request.kind !== 'btc-transaction') throw new Error('expected a transaction request');
    expect(request.flowId).toBe(intents[0].flowId);
    expect(request.inputs.map((i) => i.valueSats)).toEqual([100_000, 40_000]);
    expect(request.outputs).toEqual([
      { address: RECIPIENT, valueSats: 50_000, isChange: false },
      { address: signer.address, valueSats: 140_000 - 50_000 - request.feeSats, isChange: true },
    ]);
    expect(request.feeRate).toBe(10);
  });

  test('accepts a PSBT the signer already finalized, or returned as hex', async () => {
    const base = btcSignerFromWif(SENDER_WIF, TESTNET);
    const finalizing: BtcSigner = {
      ...base,
      signPsbt: async (psbt) => {
        const signed = bitcoin.Psbt.fromBase64(await base.signPsbt(psbt), { network: TESTNET });
        signed.finalizeAllInputs();
        return signed.toHex();
      },
    };
    installUtxoFetch([100_000]);
    const expected = await service.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, 10);
    installUtxoFetch([100_000]);
    expect(await service.createTransactionWithSigner(finalizing, RECIPIENT, 0.0005, 10)).toEqual(expected);
  });

  test('refuses a changed transaction, a signature from another key, and an unsigned PSBT', async () => {
    const base = btcSignerFromWif(SENDER_WIF, TESTNET);
    const other = btcSignerFromWif(OTHER_WIF, TESTNET);
    const cases: Array<[string, BtcSigner['signPsbt'], RegExp]> = [
      [
        'redirected output',
        (psbt) => {
          const p = bitcoin.Psbt.fromBase64(psbt, { network: TESTNET });
          const tampered = new bitcoin.Psbt({ network: TESTNET });
          p.txInputs.forEach((input, i) =>
            tampered.addInput({
              hash: input.hash,
              index: input.index,
              sequence: input.sequence,
              witnessUtxo: p.data.inputs[i].witnessUtxo,
            }),
          );
          tampered.addOutput({ address: other.address, value: p.txOutputs[0].value });
          return base.signPsbt(tampered.toBase64());
        },
        /different transaction/,
      ],
      [
        'corrupted signature',
        async (psbt) => {
          const signed = bitcoin.Psbt.fromBase64(await base.signPsbt(psbt), { network: TESTNET });
          const partial = signed.data.inputs[0].partialSig?.[0];
          if (!partial) throw new Error('expected a partial signature');
          const forged = Buffer.from(partial.signature);
          forged[10] ^= 0x01;
          signed.data.inputs[0].partialSig = [{ pubkey: partial.pubkey, signature: forged }];
          return signed.toBase64();
        },
        /did not sign input 0/,
      ],
      ['unsigned', (psbt) => psbt, /did not sign input 0/],
    ];
    for (const [, signPsbt, error] of cases) {
      installUtxoFetch([100_000]);
      const result = await service.createTransactionWithSigner({ ...base, signPsbt }, RECIPIENT, 0.0005, 10);
      expect(result.success).toBe(false);
      expect(result.result).toBeNull();
      expect(result.error).toMatch(error);
    }
  });

  test('a declined approval or a mismatched address builds nothing', async () => {
    const fetchMock = installUtxoFetch([100_000]);
    const { signer } = recording(SENDER_WIF, {
      approve: () => {
        throw new Error('declined');
      },
    });
    await expect(service.createTransactionWithSigner(signer, RECIPIENT, 0.0005, 10)).rejects.toThrow('declined');
    const mismatched = {
      ...btcSignerFromWif(SENDER_WIF, TESTNET),
      address: btcSignerFromWif(OTHER_WIF, TESTNET).address,
    };
    await expect(service.createTransactionWithSigner(mismatched, RECIPIENT, 0.0005, 10)).rejects.toThrow(
      /does not match its public key/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('BtcClient.createTransaction and sendBtc take a BtcSigner where they took a WIF', async () => {
    installUtxoFetch([100_000]);
    const client = new BtcClient('testnet');
    const fromWif = await client.createTransaction(SENDER_WIF, RECIPIENT, 0.0005, 10);
    installUtxoFetch([100_000]);
    expect(await client.createTransaction(btcSignerFromWif(SENDER_WIF, TESTNET), RECIPIENT, 0.0005, 10)).toEqual(
      fromWif,
    );
  });
});

describe('message signing with a BtcSigner', () => {
  const privateKey = ECPair.fromWIF(SENDER_WIF, TESTNET).privateKey?.toString('hex') as string;

  test('matches getSignature with the key, and normalises a high-s signature', async () => {
    const client = new BtcClient('testnet');
    const base = btcSignerFromWif(SENDER_WIF, TESTNET);
    const expected = client.getSignature('hello', privateKey);
    expect(await client.getSignatureWithSigner('hello', base)).toBe(expected);

    const highS: BtcSigner = {
      ...base,
      signDigest: async (digest) => {
        const { r, s } = parseDerSignature(
          derSignatureToBytes(await (base.signDigest as NonNullable<BtcSigner['signDigest']>)(digest)),
        );
        return encodeDerSignature(r, N - s);
      },
    };
    expect(await client.getSignatureWithSigner('hello', highS)).toBe(expected);
  });

  test('refuses a signature from another key, and a signer without signDigest', async () => {
    const client = new BtcClient('testnet');
    const base = btcSignerFromWif(SENDER_WIF, TESTNET);
    const other = btcSignerFromWif(OTHER_WIF, TESTNET);
    await expect(client.getSignatureWithSigner('hello', { ...base, signDigest: other.signDigest })).rejects.toThrow(
      /does not verify/,
    );
    await expect(client.getSignatureWithSigner('hello', { ...base, signDigest: undefined })).rejects.toThrow(
      /cannot sign messages/,
    );
  });

  test('signBtcNameTransferAcceptanceWithSigner equals the key version', async () => {
    const client = new VfxClient('testnet');
    const params = { name: 'alice.btc', newOwner: 'xNewOwner000000000000000000000000', timestamp: 1_800_000_000 };
    const { signer, requests } = recording();
    const withSigner = await client.signBtcNameTransferAcceptanceWithSigner({ ...params, btcSigner: signer });
    expect(withSigner).toEqual(client.signBtcNameTransferAcceptance({ ...params, btcPrivateKey: privateKey }));
    expect(requests[0]).toMatchObject({ kind: 'btc-message', purpose: 'btc-name-transfer-acceptance' });
  });
});

describe('buyBtcDomain with a BtcSigner', () => {
  const VFX_KEY = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
  const NOW = 1_800_000_000;

  function installPipeline(): { calls: CapturedCall[] } {
    return installFetch({
      '/adnr/': () => jsonResponse({ detail: 'not found' }, 404),
      '/blocks/': () => ({ count: 1, page: 1, num_pages: 1, results: [{ height: 9_000 }] }),
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
    });
  }

  test('claims the signer address with the same signed message as the key', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    const service = new KeypairService(Network.Testnet);
    const vfx = {
      privateKey: VFX_KEY,
      publicKey: service.publicFromPrivate(VFX_KEY),
      address: service.addressFromPrivate(VFX_KEY),
    };
    const btcPrivateKey = ECPair.fromWIF(SENDER_WIF, TESTNET).privateKey?.toString('hex') as string;
    const dataOf = (calls: CapturedCall[]) =>
      (calls.find((c) => c.url.includes('/raw/hash/'))?.body as { transaction: { Data: unknown } }).transaction.Data;

    const withKey = installPipeline();
    await new VfxClient('testnet', { dryRun: true, hashMode: 'server' }).buyBtcDomain(vfx, 'alice', btcPrivateKey);
    const withSigner = installPipeline();
    const { signer, requests } = recording();
    await new VfxClient('testnet', { dryRun: true, hashMode: 'server' }).buyBtcDomain(vfx, 'alice', signer);

    expect(dataOf(withSigner.calls)).toEqual(dataOf(withKey.calls));
    expect((dataOf(withSigner.calls) as { BTCAddress: string }).BTCAddress).toBe(signer.address);
    expect(requests[0]).toMatchObject({ kind: 'btc-message', purpose: 'btc-name-claim' });
  });
});

describe('Greptile review fixes', () => {
  test('a signer that changes the spent amount is refused even though its signature verifies for that amount', async () => {
    const keyPair = ECPair.fromWIF(SENDER_WIF, TESTNET);
    const base = btcSignerFromWif(SENDER_WIF, TESTNET);
    const lying: BtcSigner = {
      ...base,
      signPsbt: (psbt) => {
        const p = bitcoin.Psbt.fromBase64(psbt, { network: TESTNET });
        const utxo = p.data.inputs[0].witnessUtxo as { script: Buffer; value: number };
        p.data.inputs[0].witnessUtxo = { script: utxo.script, value: utxo.value + 1_000 };
        p.signAllInputs(keyPair);
        return p.toBase64();
      },
    };
    installUtxoFetch([100_000]);
    const result = await service.createTransactionWithSigner(lying, RECIPIENT, 0.0005, 10);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spent output of input 0/);
  });

  test("btcSignerFromWif takes 'testnet', a bitcoinjs network, or the browser namespace's placeholder", async () => {
    const real = btcSignerFromWif(SENDER_WIF, TESTNET);
    const { networks: browserNetworks } = await import('../browser/btc');
    expect(btcSignerFromWif(SENDER_WIF, 'testnet').address).toBe(real.address);
    expect(btcSignerFromWif(SENDER_WIF, browserNetworks.testnet).address).toBe(real.address);
    expect(() => btcSignerFromWif(SENDER_WIF, { name: 'nonsense' })).toThrow(/Unknown Bitcoin network/);
  });
});
