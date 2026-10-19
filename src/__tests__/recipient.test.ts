/**
 * The node refuses another network's address at admission, at every height
 * (Core `LedgerIntegrityRules.RecipientIsThisNetworks`). The SDK refuses it
 * first, before any request, so the caller sees why.
 */
import base58 from 'bs58';
import CryptoJS from 'crypto-js';
import { VfxClient, assertRecipientOnNetwork, isOtherNetworksAddress } from '../index';
import KeypairService from '../services/keypair-service';
import { RawTransactionService } from '../services/raw-transaction-service';
import { Network } from '../constants';
import { arrayToHex, byteArrayToWordArray, hexStringToByteArray } from '../utils';
import { installFetch, textResponse } from './helpers/mock-fetch';

const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const mainnetKeys = new KeypairService(Network.Mainnet);
const testnetKeys = new KeypairService(Network.Testnet);
const MAINNET_ADDRESS = mainnetKeys.addressFromPrivate(privateKey);
const TESTNET_ADDRESS = testnetKeys.addressFromPrivate(privateKey);
const mainnetKeypair = {
  privateKey,
  publicKey: mainnetKeys.publicFromPrivate(privateKey),
  address: MAINNET_ADDRESS,
};

/** A Base58Check address with an arbitrary version byte over the same hash. */
function withVersionByte(address: string, versionByte: number): string {
  const payload = base58.decode(address).slice(0, 21);
  payload[0] = versionByte;
  const checksum = CryptoJS.SHA256(CryptoJS.SHA256(byteArrayToWordArray(payload))).toString(CryptoJS.enc.Hex);
  return base58.encode(hexStringToByteArray(`${arrayToHex(payload)}${checksum.slice(0, 8)}`));
}

afterEach(() => {
  jest.resetAllMocks();
});

describe('isOtherNetworksAddress', () => {
  test('refuses the other network and a Bitcoin-style version-0 address', () => {
    expect(isOtherNetworksAddress(TESTNET_ADDRESS, Network.Mainnet)).toBe(true);
    expect(isOtherNetworksAddress(MAINNET_ADDRESS, Network.Testnet)).toBe(true);
    const versionZero = withVersionByte(MAINNET_ADDRESS, 0x00);
    expect(versionZero.startsWith('1')).toBe(true);
    expect(isOtherNetworksAddress(versionZero, Network.Mainnet)).toBe(true);
  });

  test("accepts the network's own address", () => {
    expect(MAINNET_ADDRESS.startsWith('R')).toBe(true);
    expect(TESTNET_ADDRESS.startsWith('x')).toBe(true);
    expect(isOtherNetworksAddress(MAINNET_ADDRESS, Network.Mainnet)).toBe(false);
    expect(isOtherNetworksAddress(TESTNET_ADDRESS, Network.Testnet)).toBe(false);
  });

  test('exempts reserve, shielded, placeholder and name recipients, and malformed strings', () => {
    const reserve = testnetKeys.reserveAddressFromPublic(mainnetKeypair.publicKey);
    expect(reserve.startsWith('xRBX')).toBe(true);
    for (const recipient of [
      reserve,
      'zfx_1qexampleshieldedaddress',
      'Adnr_Base',
      'Token_Base',
      'someone.vfx',
      withVersionByte(TESTNET_ADDRESS, 0x89).slice(0, -1) + '2', // bad checksum
      '',
    ]) {
      expect(isOtherNetworksAddress(recipient, Network.Mainnet)).toBe(false);
    }
  });

  test('assertRecipientOnNetwork names the network in its error', () => {
    expect(() => assertRecipientOnNetwork(TESTNET_ADDRESS, Network.Mainnet)).toThrow(
      /is not a mainnet address \(mainnet addresses start with 'R'\)/,
    );
    expect(() => assertRecipientOnNetwork(MAINNET_ADDRESS, Network.Mainnet)).not.toThrow();
  });
});

describe('send paths refuse a foreign recipient before any request', () => {
  test('RawTransactionService refuses at construction', () => {
    expect(
      () =>
        new RawTransactionService({
          network: Network.Mainnet,
          keypair: mainnetKeypair,
          toAddress: TESTNET_ADDRESS,
          amount: 1,
        }),
    ).toThrow(/not a mainnet address/);
  });

  test('sendCoin', async () => {
    const { calls } = installFetch({});
    const client = new VfxClient('mainnet');
    await expect(client.sendCoin(mainnetKeypair, TESTNET_ADDRESS, 1)).rejects.toThrow(/not a mainnet address/);
    expect(calls).toHaveLength(0);
  });

  test('transferToken', async () => {
    const { calls } = installFetch({});
    const client = new VfxClient('mainnet');
    await expect(
      client.transferToken(mainnetKeypair, {
        scIdentifier: 'sc-1',
        toAddress: TESTNET_ADDRESS,
        amount: 1,
        ticker: 'TKN',
        name: 'Token',
      }),
    ).rejects.toThrow(/not a mainnet address/);
    expect(calls).toHaveLength(0);
  });

  test('transferVbtc refuses before asking Spyglass to prepare', async () => {
    const { calls } = installFetch({});
    const client = new VfxClient('mainnet');
    await expect(
      client.transferVbtc({
        scIdentifier: 'sc-1',
        fromAddress: MAINNET_ADDRESS,
        toAddress: TESTNET_ADDRESS,
        amount: 1,
        privateKey,
      }),
    ).rejects.toThrow(/not a mainnet address/);
    expect(calls).toHaveLength(0);
  });

  test('an own-network recipient still builds (dry run)', async () => {
    installFetch({
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
      '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
      '/raw/validate-signature/': () => textResponse('true'),
      '/raw/verify/': () => ({ Result: 'Success' }),
    });
    const client = new VfxClient('mainnet', { dryRun: true });
    const other = mainnetKeys.addressFromPrivate('11'.repeat(32));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await client.sendCoin(mainnetKeypair, other, 1)).toBe('TX_HASH_ABC');
  });
});
