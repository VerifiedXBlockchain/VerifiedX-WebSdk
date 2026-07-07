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
// Conservative dust limit: change below this is folded into the fee rather
// than creating an output relay policy may reject.
const DUST_THRESHOLD = 546;

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

    constructor(isTestnet: boolean, apiBaseUrl?: string) {
        this.network = isTestnet ? TESTNET : MAINNET;
        // Overridable so a mempool.space outage or testnet generation change
        // (testnet3 -> testnet4 -> ...) doesn't require an SDK release.
        this.apiBaseUrl = apiBaseUrl ?? (isTestnet ? 'https://mempool.space/testnet4/api' : 'https://mempool.space/api');
    }

    private _buildCreateResponse(success: boolean, result: string | null, error: string | null = null): CreateTxResponse {
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
        const amountSats = Math.round(amount * BTC_TO_SATOSHI_MULTIPLIER);

        if (!Number.isFinite(amountSats) || amountSats <= 0) {
            return this._buildCreateResponse(false, null, `Invalid amount: ${amount} BTC`);
        }

        const keyPair: ECPairInterface = ECPair.fromWIF(senderWif, this.network);

        const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: this.network });

        if (address == null) {
            return this._buildCreateResponse(false, null, "Could not get address");
        }
        const utxos = await this.getUtxos(address);

        if (utxos.length === 0) {
            return this._buildCreateResponse(false, null, "No UTXOs found for the given address.");
        }

        if (!feeRate) {
            const feeRates = await this.getFeeRates();
            feeRate = feeRates?.economyFee || (this.network == TESTNET ? 2 : 5);
        }

        const psbt = new bitcoin.Psbt({ network: this.network });

        let inputSum = 0;
        let inputSize = 0;

        utxos.forEach((utxo: any) => {
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
            value: amountSats,
        });

        // Fee is estimated for the tx shape actually produced: with a change
        // output when the change is worth keeping, without one when the
        // remainder is dust (in which case it is folded into the fee).
        const overhead = 10;
        const feeWithChange = Math.ceil((inputSize + 2 * P2WPKH_OUTPUT_SIZE + overhead) * feeRate);
        const feeWithoutChange = Math.ceil((inputSize + P2WPKH_OUTPUT_SIZE + overhead) * feeRate);

        const change = inputSum - amountSats - feeWithChange;

        if (change >= DUST_THRESHOLD) {
            psbt.addOutput({
                address: address,
                value: change,
            });
        } else if (inputSum - amountSats - feeWithoutChange < 0) {
            return this._buildCreateResponse(
                false,
                null,
                `Insufficient funds: inputs total ${inputSum} sats, need ${amountSats + feeWithoutChange} sats ` +
                `(${amountSats} + ${feeWithoutChange} fee at ${feeRate} sat/vB)`,
            );
        }
        // else: sub-dust remainder is left to the miner as fee

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