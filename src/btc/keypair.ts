import { ECPairFactory, ECPairInterface } from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';

import { publicKeyToAddress, wifToPrivateKey, hashSeed, seedToPrivateKey } from './utils'

const ECPair = ECPairFactory(ecc);
const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;

const bip32 = BIP32Factory(ecc);

export default class KeypairService {

    network: bitcoin.Network;

    constructor(isTestnet: boolean) {
        this.network = isTestnet ? TESTNET : MAINNET;
    }


    private buildOutput(keyPair: ECPairInterface, mnemonic: string | null = null) {
        const addresses = publicKeyToAddress(keyPair.publicKey, this.network);
        const privateKey = keyPair.privateKey?.toString('hex');

        return {
            address: addresses.bech32,
            addresses: addresses,
            wif: keyPair.toWIF(),
            privateKey: privateKey,
            publicKey: keyPair.publicKey.toString('hex'),
            ...mnemonic && { mnemonic }
        }
    }

    public keypairFromRandom() {
        const keyPair = ECPair.makeRandom({ network: this.network });
        return this.buildOutput(keyPair);
    }

    public keypairFromWif(wif: string) {
        const keyPair = ECPair.fromWIF(wif, this.network);
        return this.buildOutput(keyPair);
    }



    public keypairFromPrivateKey(privateKeyString: string) {
        const privateKeyBuffer = Buffer.from(privateKeyString, 'hex');
        const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network: this.network });
        return this.buildOutput(keyPair);
    }

    public keypairFromMnemonic(mnemonic: string, index = 0) {

        const seed = bip39.mnemonicToSeedSync(mnemonic);

        const root = bip32.fromSeed(seed, this.network);

        const child1 = root.derivePath(`m/44'/0'/0'/0/${index}`);
        const privateKey = wifToPrivateKey(child1.toWIF(), this.network);
        if (!privateKey) throw new Error('Invalid private key');

        const keyPair = ECPair.fromPrivateKey(privateKey, { network: this.network });
        // const child2 = root.deriveHardened(44).deriveHardened(0).deriveHardened(0).derive(0).derive(0);
        return this.buildOutput(keyPair, mnemonic);

    }

    public keypairFromRandomMnemonic() {
        const mnemonic = bip39.generateMnemonic(256);
        return this.keypairFromMnemonic(mnemonic);
    }

    public keypairFromEmailPassword(email: string, password: string, index = 0) {

        email = email.toLowerCase();
        let seed = `${email}|${password}|`;
        seed = `${seed}${seed.length}|!@${((password.length * 7) + email.length) * 7}`;

        const regChars = /[a-z]+/g;
        const regUpperChars = /[A-Z]+/g;
        const regNumbers = /[0-9]+/g;

        const charsMatches = password.match(regChars);
        const chars = charsMatches ? charsMatches.length : 1;

        const upperCharsMatches = password.match(regUpperChars);
        const upperChars = upperCharsMatches ? upperCharsMatches.length : 1;

        const numbersMatches = password.match(regNumbers);
        const numbers = numbersMatches ? numbersMatches.length : 1;

        seed = `${seed}${(chars + upperChars + numbers) * password.length}3571`;
        seed = `${seed}${seed}`

        for (let i = 0; i <= 50; i++) {
            seed = hashSeed(seed)
        }


        const privateKey = seedToPrivateKey(seed, index, this.network);
        if (!privateKey) throw new Error('Invalid private key');

        const keyPair = ECPair.fromPrivateKey(privateKey, { network: this.network });
        return this.buildOutput(keyPair);

    }


    public signMessage(wif: string, message: string) {
        const keyPair = ECPair.fromWIF(wif, this.network);
        const messageBuffer = Buffer.from(message, 'utf8')

        const messageHash = bitcoin.crypto.hash256(messageBuffer);
        const signature = keyPair.sign(messageHash);

        const derEncodedSignature = signature.toString('hex');
        const publicKeyHex = keyPair.publicKey.toString('hex');

        const fullSignature = `30440220${injectAfter64thChar(derEncodedSignature, '0220')}.${publicKeyHex}`;

        return fullSignature;
    }


    public signMessageWithPrivateKey(privateKeyHex: string, message: string) {
        const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');

        const keyPair = ECPair.fromPrivateKey(privateKeyBytes);


        const messageBuffer = Buffer.from(message, 'utf8')

        const messageHash = bitcoin.crypto.hash256(messageBuffer);
        const signature = keyPair.sign(messageHash);

        const derEncodedSignature = signature.toString('hex');
        const publicKeyHex = keyPair.publicKey.toString('hex');

        const fullSignature = `30440220${injectAfter64thChar(derEncodedSignature, '0220')}.${publicKeyHex}`;

        return fullSignature;
    }

}

function injectAfter64thChar(inputString: string, charToInject: string) {
    // Check if the input string has at least 64 characters
    if (inputString.length <= 64) {
        return inputString + charToInject;
    }

    // Inject the character after the 64th character
    return inputString.slice(0, 64) + charToInject + inputString.slice(64);
}