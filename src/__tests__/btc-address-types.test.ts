import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import BtcClient from '../btc';
import TransactionService from '../btc/transaction';
import { BtcSpendType, addressForSpendType } from '../btc/address-types';
import { btcSignerFromWif } from '../btc/signer';
import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { CapturedCall, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const TESTNET = bitcoin.networks.testnet;
const WIF = 'cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M';
const keyPair = ECPair.fromWIF(WIF, TESTNET);
const RECIPIENT = 'tb1qag9awtlf96mx998m9x76pue86akj6hgr0flf8c';
const VALUE = 100_000;

/** Fund `address` with one UTXO from a made-up previous transaction, served like Esplora. */
function fund(address: string): bitcoin.Transaction {
  const prev = new bitcoin.Transaction();
  prev.addInput(Buffer.alloc(32, 7), 0);
  prev.addOutput(bitcoin.address.toOutputScript(address, TESTNET), VALUE);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/utxo')) return new Response(JSON.stringify([{ txid: prev.getId(), vout: 0, value: VALUE }]));
    if (url.endsWith('/raw')) return new Response(prev.toBuffer());
    if (url.includes('/fees/recommended')) return new Response(JSON.stringify({ economyFee: 2 }));
    throw new Error(`No mock for ${url}`);
  }) as unknown as typeof fetch;
  return prev;
}

/** Whether input 0 of `tx` carries a valid signature for `address`'s key. */
function inputVerifies(tx: bitcoin.Transaction, address: string, type: BtcSpendType): boolean {
  const script = bitcoin.address.toOutputScript(address, TESTNET);
  if (type === 'p2tr' || type === 'p2tr-bip86') {
    const hash = tx.hashForWitnessV1(0, [script], [VALUE], bitcoin.Transaction.SIGHASH_DEFAULT);
    return ecc.verifySchnorr(hash, script.subarray(2), tx.ins[0].witness[0].subarray(0, 64));
  }
  if (type === 'p2pkh') {
    const [sigChunk, pubkey] = bitcoin.script.decompile(tx.ins[0].script) as Buffer[];
    const sig = bitcoin.script.signature.decode(sigChunk);
    return ecc.verify(tx.hashForSignature(0, script, sig.hashType), pubkey, sig.signature);
  }
  const [sigChunk, pubkey] = tx.ins[0].witness;
  const sig = bitcoin.script.signature.decode(sigChunk);
  const scriptCode = bitcoin.payments.p2pkh({ pubkey }).output as Buffer;
  return ecc.verify(tx.hashForWitnessV0(0, scriptCode, VALUE, sig.hashType), pubkey, sig.signature);
}

afterEach(() => jest.restoreAllMocks());

const TYPES: BtcSpendType[] = ['p2pkh', 'p2sh-p2wpkh', 'p2tr', 'p2tr-bip86'];

describe('address types', () => {
  test("'p2tr' is the bech32m address the SDK shows; 'p2tr-bip86' is the standard one", () => {
    const shown = new BtcClient('testnet').addressFromWif(WIF).addresses;
    expect(addressForSpendType(keyPair.publicKey, 'p2tr', TESTNET)).toBe(shown.bech32m);
    expect(addressForSpendType(keyPair.publicKey, 'p2pkh', TESTNET)).toBe(shown.p2pkh);
    expect(addressForSpendType(keyPair.publicKey, 'p2sh-p2wpkh', TESTNET)).toBe(shown.p2sh);
    expect(addressForSpendType(keyPair.publicKey, 'p2wpkh', TESTNET)).toBe(shown.bech32);
    expect(addressForSpendType(keyPair.publicKey, 'p2tr-bip86', TESTNET)).toBe(
      bitcoin.payments.p2tr({ internalPubkey: keyPair.publicKey.subarray(1), network: TESTNET }).address,
    );
  });

  test.each(TYPES)('a WIF spends from its %s address with a valid signature', async (type) => {
    const from = addressForSpendType(keyPair.publicKey, type, TESTNET) as string;
    fund(from);
    const result = await new TransactionService(true).createTransaction(WIF, RECIPIENT, 0.0005, 2, {
      addressType: type,
    });
    expect(result.success).toBe(true);
    const tx = bitcoin.Transaction.fromHex(result.result as string);
    expect(inputVerifies(tx, from, type)).toBe(true);
    // Change goes back to the same address.
    expect(tx.outs.map((o) => bitcoin.address.fromOutputScript(o.script, TESTNET))).toEqual([RECIPIENT, from]);
  });

  test('the default is unchanged: no addressType spends the P2WPKH address as before', async () => {
    const from = addressForSpendType(keyPair.publicKey, 'p2wpkh', TESTNET) as string;
    fund(from);
    const implicit = await new TransactionService(true).createTransaction(WIF, RECIPIENT, 0.0005, 2);
    fund(from);
    const explicit = await new TransactionService(true).createTransaction(WIF, RECIPIENT, 0.0005, 2, {
      addressType: 'p2wpkh',
    });
    expect(explicit).toEqual(implicit);
  });

  test.each(TYPES)('a BtcSigner for %s builds the same transaction as the WIF', async (type) => {
    const from = addressForSpendType(keyPair.publicKey, type, TESTNET) as string;
    fund(from);
    const withWif = await new TransactionService(true).createTransaction(WIF, RECIPIENT, 0.0005, 2, {
      addressType: type,
    });
    fund(from);
    const signer = btcSignerFromWif(WIF, TESTNET, type);
    expect(signer.address).toBe(from);
    const withSigner = await new TransactionService(true).createTransactionWithSigner(signer, RECIPIENT, 0.0005, 2);
    expect(withSigner.success).toBe(true);
    // Schnorr signatures carry fresh randomness, so compare the transaction
    // without its signatures and check the signer's one verifies.
    const strip = (hex: string) => {
      const tx = bitcoin.Transaction.fromHex(hex);
      tx.ins.forEach((input) => {
        input.script = Buffer.alloc(0);
        input.witness = [];
      });
      return tx.toHex();
    };
    expect(strip(withSigner.result as string)).toBe(strip(withWif.result as string));
    expect(inputVerifies(bitcoin.Transaction.fromHex(withSigner.result as string), from, type)).toBe(true);
  });

  test('a BtcSigner that finalizes a non-P2WPKH input is refused, so the signature can be checked', async () => {
    const from = addressForSpendType(keyPair.publicKey, 'p2pkh', TESTNET) as string;
    fund(from);
    const base = btcSignerFromWif(WIF, TESTNET, 'p2pkh');
    const finalizing = {
      ...base,
      signPsbt: async (psbt: string) => {
        const signed = bitcoin.Psbt.fromBase64(await base.signPsbt(psbt), { network: TESTNET });
        signed.finalizeAllInputs();
        return signed.toBase64();
      },
    };
    const result = await new TransactionService(true).createTransactionWithSigner(finalizing, RECIPIENT, 0.0005, 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/return p2pkh inputs unfinalized/);
  });

  test("BtcClient rejects an options.addressType that contradicts the signer's", async () => {
    await expect(
      new BtcClient('testnet').createTransaction(btcSignerFromWif(WIF, TESTNET), RECIPIENT, 0.0005, 2, {
        addressType: 'p2tr',
      }),
    ).rejects.toThrow(/set it on the signer/);
  });
});

describe('WIF for the .btc name flows', () => {
  const hexKey = keyPair.privateKey?.toString('hex') as string;

  test('signBtcNameTransferAcceptance takes a WIF and signs as the hex key does', () => {
    const client = new VfxClient('testnet');
    const params = { name: 'alice.btc', newOwner: 'xNewOwner000000000000000000000000', timestamp: 1_800_000_000 };
    expect(client.signBtcNameTransferAcceptance({ ...params, btcPrivateKey: WIF })).toEqual(
      client.signBtcNameTransferAcceptance({ ...params, btcPrivateKey: hexKey }),
    );
    expect(() => client.signBtcNameTransferAcceptance({ ...params, btcPrivateKey: 'not-a-key' })).toThrow(
      /neither 64 hex characters nor a testnet WIF/,
    );
  });

  test('buyBtcDomain takes a WIF and claims the same address with the same signature', async () => {
    const NOW = 1_800_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    const service = new KeypairService(Network.Testnet);
    const vfxKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
    const vfx = {
      privateKey: vfxKey,
      publicKey: service.publicFromPrivate(vfxKey),
      address: service.addressFromPrivate(vfxKey),
    };
    const install = () =>
      installFetch({
        '/adnr/': () => jsonResponse({ detail: 'not found' }, 404),
        '/blocks/': () => ({ count: 1, page: 1, num_pages: 1, results: [{ height: 9_000 }] }),
        '/raw/timestamp/': () => textResponse('1700000000'),
        '/raw/nonce/': () => textResponse('7'),
        '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
        '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
        '/raw/validate-signature/': () => textResponse('true'),
        '/raw/verify/': () => ({ Result: 'Success' }),
      });
    const dataOf = (calls: CapturedCall[]) =>
      (calls.find((c) => c.url.includes('/raw/hash/'))?.body as { transaction: { Data: unknown } }).transaction.Data;
    const withHex = install();
    await new VfxClient('testnet', { dryRun: true, hashMode: 'server' }).buyBtcDomain(vfx, 'alice', hexKey);
    const withWif = install();
    await new VfxClient('testnet', { dryRun: true, hashMode: 'server' }).buyBtcDomain(vfx, 'alice', WIF);
    expect(dataOf(withWif.calls)).toEqual(dataOf(withHex.calls));
  });
});

describe('Greptile review fixes', () => {
  test('a P2PKH UTXO whose reported amount differs from its previous transaction stops the payment', async () => {
    const from = addressForSpendType(keyPair.publicKey, 'p2pkh', TESTNET) as string;
    const prev = fund(from);
    const real = global.fetch as jest.Mock;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/utxo')) {
        // The API under-reports the amount: legacy signatures would not catch it.
        return new Response(JSON.stringify([{ txid: prev.getId(), vout: 0, value: VALUE - 50_000 }]));
      }
      return real(input, init);
    }) as unknown as typeof fetch;
    const result = await new TransactionService(true).createTransaction(WIF, RECIPIENT, 0.0001, 2, {
      addressType: 'p2pkh',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not match its previous transaction/);
  });

  test("addressForSpendType takes 'testnet' or the browser namespace's network placeholder", async () => {
    const { networks: browserNetworks } = await import('../browser/btc');
    const expected = addressForSpendType(keyPair.publicKey, 'p2tr', TESTNET);
    expect(addressForSpendType(keyPair.publicKey, 'p2tr', 'testnet')).toBe(expected);
    expect(addressForSpendType(keyPair.publicKey, 'p2tr', browserNetworks.testnet)).toBe(expected);
  });
});
