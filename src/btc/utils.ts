/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import { BIP32Factory } from 'bip32';

import { RegtestUtils } from 'regtest-client';
import { SATOSHI_TO_BTC_MULTIPLIER } from './constants';

const APIPASS = process.env.APIPASS || 'satoshi';
const APIURL = process.env.APIURL || 'https://regtest.bitbank.cc/1';

export const regtestUtils = new RegtestUtils({ APIPASS, APIURL });

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

bitcoin.initEccLib(ecc);

export const publicKeyToAddress = (publicKey: Buffer, network: bitcoin.Network) => {

    const p2pkh = bitcoin.payments.p2pkh({ pubkey: publicKey, network }).address; //P2PKH (Legacy)
    const p2sh = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({ pubkey: publicKey, network }),
        network
    }).address;
    const bech32 = bitcoin.payments.p2wpkh({ pubkey: publicKey, network }).address; // Bech32 (Segwit)


    const bech32m = bitcoin.payments.p2tr({ pubkey: publicKey.length === 33 ? publicKey.slice(1) : publicKey, network }).address; // Taproot - P2TR)

    return {
        p2pkh, p2sh, bech32, bech32m
    }


}

export const wifToPrivateKey = (wif: string, network: bitcoin.Network) => {
    return ECPair.fromWIF(wif, network).privateKey;
}

export const seedToPrivateKey = (seed: string, index = 0, network: bitcoin.Network) => {
    const root = bip32.fromSeed(Buffer.from(seed, 'hex'), network);
    const child = root.derivePath(`m/44'/0'/0'/0/${index}`);
    return wifToPrivateKey(child.toWIF(), network);
}

export function hashSeed(seed: string) {

    const seedBuffer = Buffer.from(seed);
    const hashBuffer = bitcoin.crypto.sha256(seedBuffer);

    const hashHex = hashBuffer.toString('hex');

    return hashHex;


}

export async function streamToBuffer(stream: ReadableStream<Uint8Array> | null): Promise<Buffer> {
    if (!stream) {
        throw new Error('Stream is null');
    }

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    let done = false;

    while (!done) {
        const { value, done: isDone } = await reader.read();
        if (value) {
            chunks.push(value);
        }
        done = isDone;
    }

    // Concatenate all Uint8Array chunks into a single Uint8Array
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    // Convert the final Uint8Array into a Buffer
    return Buffer.from(result);
}


