/* eslint-disable @typescript-eslint/no-explicit-any */
import { ECPairFactory, ECPairInterface } from 'ecpair';

import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { BTC_TO_SATOSHI_MULTIPLIER } from './constants';



const ECPair = ECPairFactory(ecc);

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;
const P2WPKH_INPUT_SIZE = 68;
const P2WPKH_OUTPUT_SIZE = 31;

interface CreateTxResponse {
    success: boolean;
    result: string | null;
    error: string | null;
}

interface BroadcastTxResponse {
    success: boolean;
    result: string | null;
    error: string | null;
}

interface FeeRates {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
    minimumFee: number;
}


export default class TransactionService {
    network: bitcoin.Network;
    apiBaseUrl: string;

    constructor(isTestnet: boolean) {
        this.network = isTestnet ? TESTNET : MAINNET;
        this.apiBaseUrl = isTestnet ? 'https://mempool.space/testnet4/api' : 'https://mempool.space/api';
    }

    private _buildCreateResponse(success: boolean, result: string | null, error: string | null = null): CreateTxResponse {
        if (!success) {
            console.log("ERRROR: ", error);
        }
        return {
            success,
            result,
            error,
        };
    }

    private _buildBroadcastResponse(success: boolean, result: string | null, error: string | null = null): BroadcastTxResponse {
        return {
            success,
            result,
            error,
        };
    }

    public async getFeeRates(): Promise<FeeRates | null> {
        try {

            const response = await fetch(`${this.apiBaseUrl}/v1/fees/recommended`);
            if (!response.ok) {
                return null;
            }
            const feeRates = await response.json();
            return feeRates;
        } catch (e) {
            return null;
        }
    }


    private async getUtxos(address: string) {
        const response = await fetch(`${this.apiBaseUrl}/address/${address}/utxo`);
        if (!response.ok) {
            throw new Error('Error getting utxos');
        }
        const data = await response.json();
        return data;
    }

    public async getRawTx(txId: string) {
        const url = `${this.apiBaseUrl}/tx/${txId}/raw`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Error fetching raw transaction: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        const buffer = Buffer.from(arrayBuffer);

        return buffer;
    }

    public async createTransaction(senderWif: string, recipientAddress: string, amount: number, feeRate = 0): Promise<CreateTxResponse> {
        amount = Math.round(amount * BTC_TO_SATOSHI_MULTIPLIER);


        const keyPair: ECPairInterface = ECPair.fromWIF(senderWif, this.network);

        const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: this.network });


        if (address == null) {
            return this._buildCreateResponse(false, null, "Could not get address");
        }
        const utxos = await this.getUtxos(address);

        if (utxos.length === 0) {
            return this._buildCreateResponse(false, null, "No UTXOs found for the given address.");
        }

        const psbt = new bitcoin.Psbt({ network: this.network });

        let inputSum = 0;
        let inputSize = 0;
        let outputSize = 0;

        utxos.forEach(async (utxo: any) => {

            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                sequence: 0xfffffffd,
                witnessUtxo: {
                    script: bitcoin.address.toOutputScript(address, this.network),
                    value: utxo.value, // satoshis
                },
            });
            inputSum += utxo.value;
            inputSize += P2WPKH_INPUT_SIZE;
        });

        psbt.addOutput({
            address: recipientAddress,
            value: amount,
        });

        outputSize += P2WPKH_OUTPUT_SIZE;

        // for change output
        outputSize += P2WPKH_OUTPUT_SIZE;
        const txSize = inputSize + outputSize + 10;

        if (!feeRate) {
            const feeRates = await this.getFeeRates();
            feeRate = feeRates?.economyFee || (this.network == TESTNET ? 2 : 5);
        }

        if (this.network == TESTNET) {
            feeRate = 5;
        }

        const fee = txSize * feeRate;

        const change = inputSum - amount - fee;
        if (change > 0) {
            psbt.addOutput({
                address: address,
                value: change,
            });
        }

        psbt.signAllInputs(keyPair);
        psbt.finalizeAllInputs();

        const transactionHex = psbt.extractTransaction().toHex();

        return this._buildCreateResponse(true, transactionHex, null);

    }

    async broadcastTransaction(transactionHex: string) {

        try {
            const response = await fetch(`${this.apiBaseUrl}/tx`, { method: 'POST', body: transactionHex, headers: { 'Content-Type': 'text/plain' }, },);
            if (!response.ok) {
                const error = await response.text();
                return this._buildBroadcastResponse(false, null, `Error: ${error}`);
            }
            const hash = await response.text();

            return this._buildBroadcastResponse(true, hash, null);

        } catch (error) {
            return this._buildBroadcastResponse(false, null, `Error: ${error}`);
        }
    }
}