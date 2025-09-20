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



// export const createPayment = (_type: string, myKeys: any[], network: any): any => {

//     const splitType = _type.split('-').reverse();
//     const isMultisig = splitType[0].slice(0, 4) === 'p2ms';
//     const keys = myKeys || [];
//     let m: number | undefined;
//     if (isMultisig) {
//         const match = splitType[0].match(/^p2ms\((\d+) of (\d+)\)$/);
//         m = parseInt(match![1], 10);
//         let n = parseInt(match![2], 10);
//         if (keys.length > 0 && keys.length !== n) {
//             throw new Error('Need n keys for multisig');
//         }
//         while (!myKeys && n > 1) {
//             keys.push(ECPair.makeRandom({ network }));
//             n--;
//         }
//     }
//     if (!myKeys) keys.push(ECPair.makeRandom({ network }));

//     let payment: any;
//     splitType.forEach(type => {
//         if (type.slice(0, 4) === 'p2ms') {
//             payment = bitcoin.payments.p2ms({
//                 m,
//                 pubkeys: keys.map(key => key.publicKey).sort((a, b) => a.compare(b)),
//                 network,
//             });
//         } else if (['p2sh', 'p2wsh'].indexOf(type) > -1) {
//             payment = (bitcoin.payments as any)[type]({
//                 redeem: payment,
//                 network,
//             });
//         } else {
//             payment = (bitcoin.payments as any)[type]({
//                 pubkey: keys[0].publicKey,
//                 network,
//             });
//         }
//     });

//     return {
//         payment,
//         keys,
//     };
// }


// export const getInputData = async (
//     amount: number,
//     payment: any,
//     isSegwit: boolean,
//     redeemType: string,
// ): Promise<any> => {
//     const unspent = await regtestUtils.faucetComplex(payment.output, amount);
//     console.log({ unspent })
//     const utx = await regtestUtils.fetch(unspent.txId);
//     console.log({ utx })

//     // for non segwit inputs, you must pass the full transaction buffer
//     const nonWitnessUtxo = Buffer.from(utx.txHex, 'hex');
//     // for segwit inputs, you only need the output script and value as an object.
//     const witnessUtxo = getWitnessUtxo(utx.outs[unspent.vout]);

//     console.log({ witnessUtxo })
//     const mixin = isSegwit ? { witnessUtxo } : { nonWitnessUtxo };
//     const mixin2: any = {};
//     switch (redeemType) {
//         case 'p2sh':
//             mixin2.redeemScript = payment.redeem.output;
//             break;
//         case 'p2wsh':
//             mixin2.witnessScript = payment.redeem.output;
//             break;
//         case 'p2sh-p2wsh':
//             mixin2.witnessScript = payment.redeem.redeem.output;
//             mixin2.redeemScript = payment.redeem.output;
//             break;
//     }
//     return {
//         hash: unspent.txId,
//         index: unspent.vout,
//         ...mixin,
//         ...mixin2,
//     };
// }

// const getWitnessUtxo = (out: any): any => {
//     delete out.address;
//     out.script = Buffer.from(out.script, 'hex');
//     return out;
// }

// export const createTx = async (toAddress: string, value: number, env: "mainnet" | "testnet4", fromAddress: string) => {
//     const valueInSatoshi = Math.round(value * 100000000);
//     if (!fromAddress || !toAddress || !value || !env) {
//         return {
//             code: 0,
//             message: "invalid/insufficient parameters"
//         }
//     }

//     const url = env === "mainnet" ? "https://api.blockcypher.com/v1/btc/main/txs/new" : "https://api.blockcypher.com/v1/btc/test4/txs/new";
//     const data = JSON.stringify({
//         "inputs": [
//             {
//                 "addresses": [
//                     `${fromAddress}`  /* "n1TKu4ZX7vkyjfvo7RCbjeUZB6Zub8N3fN" */
//                 ]
//             }
//         ],
//         "outputs": [
//             {
//                 "addresses": [
//                     `${toAddress}` /* "2NCY42y4mbvJCxhd7gcCroBEvVh1dXkbPzA"
// */                    ],
//                 "value": valueInSatoshi
//             }
//         ]
//     });


//     const response = await fetch(url, { method: "POST", body: data, headers: { 'Content-Type': 'application/json' } })

//     if (!response.ok) {
//         const jsonData = await response.json();

//         return {
//             code: 0,
//             message: JSON.stringify(jsonData['errors']),
//         }
//     }

//     const jsonData = await response.json();

//     return {
//         code: 1,
//         result: jsonData
//     }


// }

// export const generateTxSignatures = (senderWif: string, network: bitcoin.Network, toSign: any) => {
//     const keys = ECPair.fromWIF(senderWif, network)

//     const signatures = [];
//     const pubkeys = [];

//     for (let i = 0; i < toSign.length; i++) {

//         signatures.push(
//             bitcoin.script.signature
//                 .encode(keys.sign(Buffer.from(toSign[i], 'hex')), 0x01)
//                 .toString('hex')
//             // .slice(0, -2),
//         );
//         pubkeys.push(keys.publicKey.toString('hex'));
//     }


//     return {
//         code: 1,
//         signatures,
//         pubkeys,
//     };
// }

// export const sendTx = async (tx: any, tosign: any, signatures: any, pubkeys: any, env: "mainnet" | "testnet") => {
//     const url = env === "mainnet" ? "https://api.blockcypher.com/v1/btc/main/txs/send?token=8204f6d6308846d9a26daa8c19d51a64" : "https://api.blockcypher.com/v1/btc/test4/txs/send?token=8204f6d6308846d9a26daa8c19d51a64";


//     const data = {
//         tx,
//         signatures,
//         pubkeys,
//         tosign,
//     }

//     const response = await fetch(url, { method: "POST", body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } })


//     if (!response.ok) {

//         const jsonData = await response.json();


//         return {
//             success: false,
//             result: null,
//             message: JSON.stringify(jsonData['errors']),
//         }
//     }

//     const jsonData = await response.json();

//     return {
//         success: true,
//         result: jsonData,
//         message: 'success',
//     }


// }

