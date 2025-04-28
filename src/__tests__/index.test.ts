import { type Keypair, KeypairService, VfxClient } from '../index';
import CryptoJS from 'crypto-js';

import dotenv from 'dotenv';
import { isValidAddress, isValidPrivateKey } from '../utils';
import { Network } from '../constants';
import { AddressApiClient } from '../client/address-api-client';
dotenv.config({ path: 'test.env' })


const network: Network = Network.Testnet;
const dryRun: boolean = true;


describe('test env vars', () => {

  const expectedEnvVars = ['PRIVATE_KEY', 'FROM_ADDRESS', 'TO_ADDRESS', 'VFX_API_BASE_URL_TESTNET', 'VFX_API_BASE_URL_MAINNET'];

  for (const entry of expectedEnvVars) {
    test(`${entry}`, () => {
      const item = process.env[entry];
      expect(item).not.toBe(undefined);
    })
  }

})

describe('generate a private key', () => {

  test('private key should should be valid', () => {
    const keypairService = new KeypairService(network);
    const privateKey = keypairService.generatePrivateKey();
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
    const keypairService = new KeypairService(network);

    for (let i = 0; i < PRIVATE_KEYS.length; i++) {

      const privateKey = PRIVATE_KEYS[i];
      const expectedAddress = EXPECTED_ADDRESSES[i];

      const address = keypairService.addressFromPrivate(privateKey);
      expect(address == expectedAddress).toBe(true);
    }

  });

});



describe('create private key and generate address', () => {


  test('should result in a valid RBX address', () => {
    const keypairService = new KeypairService(network);

    const privateKey = keypairService.generatePrivateKey();
    const address = keypairService.addressFromPrivate(privateKey);
    expect(isValidAddress(address, network)).toBe(true);
  });

});


describe('generate mnemonic phrase', () => {

  test('should result in 12 words', () => {
    const keypairService = new KeypairService(network);
    const phrase = keypairService.generateMnemonic();
    expect(phrase.split(' ').length).toBe(12);
  });

  test('should result in 24 words', () => {
    const keypairService = new KeypairService(network);
    const phrase = keypairService.generateMnemonic(24);
    expect(phrase.split(' ').length).toBe(24);
  });

});

describe('generate mnemonic and create private key', () => {

  test('private key should be valid', () => {
    const keypairService = new KeypairService(network);
    const phrase = keypairService.generateMnemonic();
    const privateKey = keypairService.privateKeyFromMneumonic(phrase, 0);
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(privateKey);
    expect(isValidPrivateKey(privateKeyWordArray)).toBe(true);
  });

  test('address should be valid', () => {
    const keypairService = new KeypairService(network);
    const phrase = keypairService.generateMnemonic();
    const privateKey = keypairService.privateKeyFromMneumonic(phrase, 0);
    const address = keypairService.addressFromPrivate(privateKey);
    expect(isValidAddress(address, network)).toBe(true);
  });

});

describe("address checks", () => {

  let keypair: Keypair;
  let keypairService: KeypairService;
  let addressApiClient: AddressApiClient;

  beforeAll(() => {

    keypairService = new KeypairService(network);
    addressApiClient = new AddressApiClient(network);

    keypair = {
      privateKey: process.env.PRIVATE_KEY!,
      publicKey: keypairService.publicFromPrivate(process.env.PRIVATE_KEY!),
      address: keypairService.addressFromPrivate(process.env.PRIVATE_KEY!),
    }
  })

  test("get address details", async () => {
    const details = await addressApiClient.getAddressDetails(keypair.address);
    expect(details).toBeTruthy();
    expect(details?.balance).toBeGreaterThan(1);
  })


  test("domain exists", async () => {
    const exists = await addressApiClient.domainAvailable("test.vfx");
    expect(exists).toEqual(false);
  })
})

describe('transaction checks', () => {

  let vfxClient: VfxClient;
  let keypair: Keypair;
  let keypairService: KeypairService;
  beforeAll(() => {

    vfxClient = new VfxClient(Network.Testnet, dryRun)
    keypairService = new KeypairService(network);

    keypair = {
      privateKey: process.env.PRIVATE_KEY!,
      publicKey: keypairService.publicFromPrivate(process.env.PRIVATE_KEY!),
      address: keypairService.addressFromPrivate(process.env.PRIVATE_KEY!)
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


// function publicFromPrivate(): string {
//   throw new Error('Function not implemented.');
// }
//   let txService: TransactionService;
//   let PRIVATE_KEY: string;

//   let txOptions: TxOptions;

//   beforeAll(() => {

//     txService = new TransactionService(process.env.WALLET_ADDRESS || "");
//     PRIVATE_KEY = process.env.PRIVATE_KEY || "";

//     txOptions = {
//       fromAddress: process.env.FROM_ADDRESS || "",
//       toAddress: process.env.TO_ADDRESS || "",
//       amount: 1.52,
//       type: TxType.transfer
//     }
//   });

//   test("transaction", async () => {
//     const t = await txService.buildTransaction(txOptions);
//     expect(t).toBeTruthy();
//   }, 30000)

//   test("sign and send transaction", async () => {

//     const t = await txService.buildTransaction(txOptions);
//     const hash = t['Hash'];
//     expect(hash).toBeTruthy();

//     const signature = txService.getSignature(hash, PRIVATE_KEY);

//     expect(signature).toBeTruthy();

//     const signatureIsValid = await txService.validateTransaction(hash, txOptions.fromAddress, signature);
//     expect(signatureIsValid).toBe(true);

//     t['Signature'] = signature;

//     const testTxHash = await txService.broadcastTransaction(t, true);
//     expect(testTxHash).toBeTruthy();

//   }, 30000)

//   test("send transaction", async () => {
//     const transactionHash = txService.buildAndSendTransaction(txOptions, PRIVATE_KEY, true);
//     expect(transactionHash).toBeTruthy();
//   }, 30000)

// });

// describe('explorer checks', () => {

//   let explorerService: ExplorerService;

//   beforeAll(() => {
//     explorerService = new ExplorerService(process.env.EXPLORER_ADDRESS || "https://data.rbx.network/api");
//   });

//   test("latest block", async () => {

//     const block = await explorerService.latestBlock();
//     expect(block).toBeTruthy();
//     expect(block.height).toBeGreaterThan(703789);
//   }, 30000)

//   test("5 blocks", async () => {

//     const response = await explorerService.blocks(5);
//     expect(response.results.length).toBe(5);
//   }, 30000)

//   test("address", async () => {

//     const address = await explorerService.getAddress(process.env.FROM_ADDRESS || "");
//     expect(address).toBeTruthy();
//   }, 30000)

//   test("balance", async () => {

//     const balance = await explorerService.getBalance(process.env.FROM_ADDRESS || "");
//     expect(balance).toBeGreaterThan(0);
//   }, 30000)

// });

// describe('ensure mnumonic results in correct private key and address', () => {

//   let MNUMONIC: string;
//   let EXPECTED_PRIVATE_KEY: string;
//   let EXPECTED_ADDRESS: string;

//   beforeAll(() => {
//     MNUMONIC = 'provide fun correct gym swim control reopen nasty jacket window trap action';
//     EXPECTED_PRIVATE_KEY = "2de45504622ea03f740f681f2908cce0d83b988eda6acebeeb23d2c7bc59251e";
//     EXPECTED_ADDRESS = "R9dRdKbCRC2zbecz7gnf5po5Wr8fF2uwtp";
//   })

//   test('private key should generate valid RBX address', () => {
//     const privateKey = keypair.privateKeyFromMneumonic(MNUMONIC, 1);
//     // const privateKeyWordArray = CryptoJS.enc.Hex.parse(privateKey);
//     // expect(isValidPrivateKey(privateKeyWordArray)).toBe(true);

//     expect(privateKey).toBe(EXPECTED_PRIVATE_KEY);
//   });

// });

