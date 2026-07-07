import { VfxClient } from '../index';
import CryptoJS from 'crypto-js';

import dotenv from 'dotenv';
import { isValidAddress, isValidPrivateKey, normalizePrivateKey } from '../utils';
import { Network } from '../constants';
dotenv.config({ path: 'test.env' });

const network: Network = Network.Testnet;
const dryRun = true;

// Environment-backed checks are optional: the suite must pass on a fresh
// clone with no test.env. Provide PRIVATE_KEY + FROM_ADDRESS to also verify
// a known key/address pair (the compat suite pins derivation vectors
// deterministically regardless).
const hasEnvKeypair = !!process.env.PRIVATE_KEY && !!process.env.FROM_ADDRESS;

describe('generate a private key', () => {
  test('private key should should be valid', () => {
    const client = new VfxClient(network, dryRun);
    const privateKey = client.generatePrivateKey();
    // Private keys now have 00 prefix for CLI compatibility
    expect(privateKey).toHaveLength(66);
    expect(privateKey.startsWith('00')).toBe(true);
    const normalized = normalizePrivateKey(privateKey);
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(normalized);
    expect(isValidPrivateKey(privateKeyWordArray)).toBe(true);
  });
});

(hasEnvKeypair ? describe : describe.skip)('address from private key (env)', () => {
  test('private key should generate valid VFX address', () => {
    const client = new VfxClient(network, dryRun);
    const address = client.addressFromPrivate(process.env.PRIVATE_KEY as string);
    expect(address).toBe(process.env.FROM_ADDRESS);
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
    expect(privateKey).toHaveLength(66);
    expect(privateKey.startsWith('00')).toBe(true);
    const normalized = normalizePrivateKey(privateKey);
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(normalized);
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

describe('generate private key from email and password', () => {
  test('should generate correct address for test@verifiedx.io', () => {
    const client = new VfxClient(network, dryRun);
    const privateKey = client.privateKeyFromEmailPassword('test@verifiedx.io', 'test1234', 0);
    const address = client.addressFromPrivate(privateKey);
    expect(address).toBe('xHoSVXZ3cpM25XJC2qif3hCbzUFwYe2MLp');
  });

  test('private key should be valid', () => {
    const client = new VfxClient(network, dryRun);
    const privateKey = client.privateKeyFromEmailPassword('user@example.com', 'MyPassword123', 0);
    expect(privateKey).toHaveLength(66);
    expect(privateKey.startsWith('00')).toBe(true);
    const normalized = normalizePrivateKey(privateKey);
    const privateKeyWordArray = CryptoJS.enc.Hex.parse(normalized);
    expect(isValidPrivateKey(privateKeyWordArray)).toBe(true);
  });

  test('address should be valid', () => {
    const client = new VfxClient(network, dryRun);
    const privateKey = client.privateKeyFromEmailPassword('user@example.com', 'MyPassword123', 0);
    const address = client.addressFromPrivate(privateKey);
    expect(isValidAddress(address, network)).toBe(true);
  });

  test('should generate different addresses for different indices', () => {
    const client = new VfxClient(network, dryRun);
    const privateKey0 = client.privateKeyFromEmailPassword('test@example.com', 'password', 0);
    const privateKey1 = client.privateKeyFromEmailPassword('test@example.com', 'password', 1);
    const address0 = client.addressFromPrivate(privateKey0);
    const address1 = client.addressFromPrivate(privateKey1);
    expect(address0).not.toBe(address1);
  });
});

describe('CLI compatibility', () => {
  test('high-bit private keys should work with both 64 and 66 char formats', () => {
    const client = new VfxClient(Network.Mainnet, true);

    // Test key with high bit set (starts with 0x90)
    const pk64 = '90a805984bd65764350d644d9cfb8ca483f7f4ae1e783833f4661f93ee053b73';
    const pk66 = '00' + pk64;

    // Both formats should produce same address (WebWallet/JS address, not CLI bug address)
    const addr64 = client.addressFromPrivate(pk64);
    const addr66 = client.addressFromPrivate(pk66);

    expect(addr64).toBe(addr66);
    expect(addr64).toBe('RShL4yfSPuexMczBvsh7JDJnNngVznQbcn');
  });

  test('low-bit private keys should work with both formats', () => {
    const client = new VfxClient(Network.Mainnet, true);

    // Test key without high bit set (starts with 0x47)
    const pk64 = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
    const pk66 = '00' + pk64;

    const addr64 = client.addressFromPrivate(pk64);
    const addr66 = client.addressFromPrivate(pk66);

    expect(addr64).toBe(addr66);
    expect(addr64).toBe('RRH1Qs76UPTeTrXo4oV7XpLqfLugaReF1J');
  });
});
