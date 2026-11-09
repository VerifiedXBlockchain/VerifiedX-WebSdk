import { VfxClient, vbtcContractHasNoMedia } from '../index';
import KeypairService from '../services/keypair-service';
import { Network, TxType } from '../constants';
import { SigningIntent, SigningRequest } from '../signer';
import { HashableTransaction, transactionHash } from '../services/transaction-hash';
import { CapturedCall, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';
import EC from 'elliptic';

const curve = new EC.ec('secp256k1');
const service = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const owner = service.addressFromPrivate(privateKey);
const RECIPIENT = 'xRecipient00000000000000000000000';
const SC = 'vault-sc:1700000000';
const TX_DATA = [{ Function: 'Transfer()', ContractUID: SC, ToAddress: RECIPIENT, Locators: 'LOC123' }];

function install(overrides: Record<string, (url: string, init?: RequestInit) => unknown> = {}) {
  return installFetch({
    '/btc/vbtc-v2/beacon-upload/': () => ({ success: true, locator: 'LOC123' }),
    '/btc/vbtc-v2/ownership-transfer/': () => ({ success: true, tx_data: TX_DATA }),
    '/btc/vbtc-v2/detail/': () => ({
      sc_identifier: SC,
      nft: { primary_asset_name: 'art.png', primary_asset_size: 900 },
    }),
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/hash/': (_u: string, init?: RequestInit) => ({
      Result: 'Success',
      Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
    }),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
    ...overrides,
  });
}
const sent = (calls: CapturedCall[]) =>
  (calls.find((c) => c.url.includes('/raw/send/'))?.body as { transaction: Record<string, unknown> } | undefined)
    ?.transaction;

function signer(intents: SigningIntent[] = [], requests: SigningRequest[] = [], decline = false) {
  return {
    address: owner,
    publicKey: service.publicFromPrivate(privateKey),
    approve: (intent: SigningIntent) => {
      intents.push(intent);
      if (decline) throw new Error('declined');
    },
    signDigest: (digestHex: string, request?: SigningRequest) => {
      requests.push(request as SigningRequest);
      return Uint8Array.from(
        curve.keyFromPrivate(Buffer.from(privateKey, 'hex')).sign(Buffer.from(digestHex, 'hex')).toDER(),
      );
    },
  };
}

afterEach(() => jest.restoreAllMocks());

describe('transferVbtcOwnership', () => {
  test('uploads to a beacon with the owner signature, then sends a Type 18 to the recipient, as one flow', async () => {
    const { calls } = install();
    const intents: SigningIntent[] = [];
    const requests: SigningRequest[] = [];
    await new VfxClient('testnet').transferVbtcOwnership({
      scIdentifier: SC,
      toAddress: RECIPIENT,
      signer: signer(intents, requests),
    });
    const beacon = calls.find((c) => c.url.includes('/beacon-upload/')) as CapturedCall;
    const signature = decodeURIComponent(beacon.url.split('/').slice(-2)[0]);
    expect(service.verifySignature(SC, signature, owner)).toBe(true);
    expect(calls.find((c) => c.url.includes('/ownership-transfer/'))?.url).toContain(`/${RECIPIENT}/LOC123/`);
    expect(sent(calls)).toMatchObject({ TransactionType: TxType.TokenizationTx, ToAddress: RECIPIENT, Data: TX_DATA });
    expect(intents).toEqual([expect.objectContaining({ action: 'vbtc-ownership-transfer', toAddress: RECIPIENT })]);
    expect(requests.map((r) => r.kind)).toEqual(['vbtc-beacon-upload', 'transaction']);
    expect(new Set(requests.map((r) => r.flowId))).toEqual(new Set([intents[0].flowId]));
  });

  test('a failed beacon falls back to "NA" for a vault with no media', async () => {
    const { calls } = install({
      '/btc/vbtc-v2/beacon-upload/': () => jsonResponse({ success: false, message: 'no beacon' }, 500),
      '/btc/vbtc-v2/detail/': () => ({
        sc_identifier: SC,
        nft: { primary_asset_name: 'defaultvBTC_V2.png', primary_asset_size: 0 },
      }),
    });
    await new VfxClient('testnet').transferVbtcOwnership({ scIdentifier: SC, toAddress: RECIPIENT, privateKey });
    expect(calls.find((c) => c.url.includes('/ownership-transfer/'))?.url).toContain(`/${RECIPIENT}/NA/`);
    expect(sent(calls)).toBeDefined();
  });

  test('a failed beacon for a vault with media stops, sending nothing; so does a declined approval', async () => {
    const failed = install({ '/btc/vbtc-v2/beacon-upload/': () => ({ success: true, locator: '  ' }) });
    await expect(
      new VfxClient('testnet').transferVbtcOwnership({ scIdentifier: SC, toAddress: RECIPIENT, privateKey }),
    ).rejects.toThrow(/has media/);
    expect(sent(failed.calls)).toBeUndefined();

    const declined = install();
    await expect(
      new VfxClient('testnet').transferVbtcOwnership({
        scIdentifier: SC,
        toAddress: RECIPIENT,
        signer: signer([], [], true),
      }),
    ).rejects.toThrow('declined');
    expect(declined.calls).toHaveLength(0);
  });

  test('from a vault the transfer waits behind its unlock time; to yourself is refused', async () => {
    const vaultKey = (() => {
      for (;;) {
        const key = service.generatePrivateKey();
        if (service.reserveAddressFromPrivate(key).startsWith('xRBX')) return key;
      }
    })();
    const vault = {
      privateKey: vaultKey,
      publicKey: service.publicFromPrivate(vaultKey),
      address: service.reserveAddressFromPrivate(vaultKey),
    };
    const { calls } = install();
    const now = Math.round(Date.now() / 1000);
    // 'server' mode: on main, a vault's own signature fails the local check
    // in 'both'/'local' until the fix in PR 26 (8942493) lands.
    const client = new VfxClient('testnet', { hashMode: 'server' });
    await (client as unknown as { transferVbtcOwnership: (p: unknown) => Promise<unknown> }).transferVbtcOwnership({
      scIdentifier: SC,
      toAddress: RECIPIENT,
      signer: {
        ...vault,
        signDigest: (d: string) =>
          Uint8Array.from(
            curve
              .keyFromPrivate(Buffer.from(vaultKey.slice(2), 'hex'))
              .sign(Buffer.from(d, 'hex'))
              .toDER(),
          ),
      },
      unlockHours: 48,
    });
    expect(sent(calls)?.UnlockTime as number).toBeGreaterThanOrEqual(now + 48 * 3600);
    await expect(client.transferVbtcOwnership({ scIdentifier: SC, toAddress: owner, privateKey })).rejects.toThrow(
      /other than the owner/,
    );
  });
});

describe('vbtcContractHasNoMedia', () => {
  test('true only for a zero-size placeholder', () => {
    expect(vbtcContractHasNoMedia({ primary_asset_name: 'vbtc_v2_token', primary_asset_size: 0 })).toBe(true);
    expect(vbtcContractHasNoMedia({ primary_asset_name: 'DefaultvBTC.png', primary_asset_size: 0 })).toBe(true);
    expect(vbtcContractHasNoMedia({ primary_asset_name: 'art.png', primary_asset_size: 0 })).toBe(false);
    expect(vbtcContractHasNoMedia({ primary_asset_name: 'vbtc_v2_token', primary_asset_size: 12 })).toBe(false);
    expect(vbtcContractHasNoMedia(null)).toBe(false);
  });
});

describe('Greptile review fixes', () => {
  test.each([
    ['another vault', [{ Function: 'Transfer()', ContractUID: 'other-sc:1', ToAddress: RECIPIENT }]],
    [
      'another recipient',
      [{ Function: 'Transfer()', ContractUID: SC, ToAddress: 'xAttacker0000000000000000000000000' }],
    ],
    ['another function', [{ Function: 'Burn()', ContractUID: SC, ToAddress: RECIPIENT }]],
    [
      'an extra instruction',
      [
        { Function: 'Transfer()', ContractUID: SC, ToAddress: RECIPIENT },
        { Function: 'Transfer()', ContractUID: 'other-sc:1', ToAddress: RECIPIENT },
      ],
    ],
  ])('transfer data naming %s is refused before signing', async (_label, txData) => {
    const requests: SigningRequest[] = [];
    const { calls } = install({ '/btc/vbtc-v2/ownership-transfer/': () => ({ success: true, tx_data: txData }) });
    await expect(
      new VfxClient('testnet').transferVbtcOwnership({
        scIdentifier: SC,
        toAddress: RECIPIENT,
        signer: signer([], requests),
      }),
    ).rejects.toThrow(/nothing was signed/);
    expect(requests.map((r) => r.kind)).toEqual(['vbtc-beacon-upload']);
    expect(sent(calls)).toBeUndefined();
  });

  test('only an explicit zero size counts as no media', () => {
    for (const size of ['', ' ', false, [], null, undefined, 'abc']) {
      expect(vbtcContractHasNoMedia({ primary_asset_name: 'vbtc_v2_token', primary_asset_size: size })).toBe(false);
    }
    expect(vbtcContractHasNoMedia({ primary_asset_name: 'vbtc_v2_token', primary_asset_size: '0' })).toBe(true);
  });
});
