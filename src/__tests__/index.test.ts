import { VfxClient } from '../index';
import CryptoJS from 'crypto-js';

import dotenv from 'dotenv';
import { isValidAddress, isValidPrivateKey } from '../utils';
import { Network } from '../constants';
import { Keypair } from '../types';
dotenv.config({ path: 'test.env' })


const network: Network = Network.Testnet;
const dryRun: boolean = true;


describe('test env vars', () => {

  const expectedEnvVars = ['PRIVATE_KEY', 'FROM_ADDRESS', 'TO_ADDRESS'];

  for (const entry of expectedEnvVars) {
    test(`${entry}`, () => {
      const item = process.env[entry];
      expect(item).not.toBe(undefined);
    })
  }

})

describe('generate a private key', () => {

  test('private key should should be valid', () => {
    const client = new VfxClient(network, dryRun);
    const privateKey = client.generatePrivateKey();
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(privateKey);
    expect(isValidPrivateKey(privateKeyWordArray)).toBe(true);
  });

});


describe('address from private key', () => {

  let PRIVATE_KEYS: string[];
  let EXPECTED_ADDRESSES: string[];

  beforeAll(() => {
    PRIVATE_KEYS = [process.env.PRIVATE_KEY ?? ""];
    EXPECTED_ADDRESSES = [process.env.FROM_ADDRESS ?? "",]
  })

  test('private key should generate valid VFX address', () => {
    const client = new VfxClient(network, dryRun);

    for (let i = 0; i < PRIVATE_KEYS.length; i++) {

      const privateKey = PRIVATE_KEYS[i];
      const expectedAddress = EXPECTED_ADDRESSES[i];

      const address = client.addressFromPrivate(privateKey);
      expect(address == expectedAddress).toBe(true);
    }

  });

});



describe('create private key and generate address', () => {


  test('should result in a valid RBX address', () => {
    const client = new VfxClient(network, dryRun);

    const privateKey = client.generatePrivateKey();
    const address = client.addressFromPrivate(privateKey);
    expect(isValidAddress(address, network)).toBe(true);
  });

});


describe('generate mnemonic phrase', () => {

  test('should result in 12 words', () => {
    const client = new VfxClient(network, dryRun);
    const phrase = client.generateMnemonic();
    expect(phrase.split(' ').length).toBe(12);
  });

  test('should result in 24 words', () => {
    const client = new VfxClient(network, dryRun);
    const phrase = client.generateMnemonic(24);
    expect(phrase.split(' ').length).toBe(24);
  });

});

describe('generate mnemonic and create private key', () => {

  test('private key should be valid', () => {
    const client = new VfxClient(network, dryRun);
    const phrase = client.generateMnemonic();
    const privateKey = client.privateKeyFromMneumonic(phrase, 0);
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(privateKey);
    expect(isValidPrivateKey(privateKeyWordArray)).toBe(true);
  });

  test('address should be valid', () => {
    const client = new VfxClient(network, dryRun);
    const phrase = client.generateMnemonic();
    const privateKey = client.privateKeyFromMneumonic(phrase, 0);
    const address = client.addressFromPrivate(privateKey);
    expect(isValidAddress(address, network)).toBe(true);
  });

});

describe("address checks", () => {

  let keypair: Keypair;
  let client: VfxClient;

  beforeAll(() => {

    client = new VfxClient(network, dryRun);


    keypair = {
      privateKey: process.env.PRIVATE_KEY!,
      publicKey: client.publicFromPrivate(process.env.PRIVATE_KEY!),
      address: client.addressFromPrivate(process.env.PRIVATE_KEY!),
    }
  })

  test("get address details", async () => {
    const details = await client.getAddressDetails(keypair.address);
    expect(details).toBeTruthy();
    expect(details?.balance).toBeGreaterThan(1);
  })


  test("domain exists", async () => {
    const exists = await client.domainAvailable("test.vfx");
    expect(exists).toEqual(false);
  })
})

describe('transaction checks', () => {

  let vfxClient: VfxClient;
  let keypair: Keypair;
  beforeAll(() => {

    vfxClient = new VfxClient(Network.Testnet, dryRun)

    keypair = {
      privateKey: process.env.PRIVATE_KEY!,
      publicKey: vfxClient.publicFromPrivate(process.env.PRIVATE_KEY!),
      address: vfxClient.addressFromPrivate(process.env.PRIVATE_KEY!)
    }
  })

  test("send coin", async () => {
    const hash = await vfxClient.sendCoin(keypair, process.env.TO_ADDRESS!, 1.0);
    expect(hash).toBeTruthy();
  })


  test("buy domain", async () => {
    const hash = await vfxClient.buyVfxDomain(keypair, 'test123.vfx');
    expect(hash).toBeTruthy();
  })

});

