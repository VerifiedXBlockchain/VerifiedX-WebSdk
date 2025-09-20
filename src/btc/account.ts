import * as bitcoin from 'bitcoinjs-lib';
import { SATOSHI_TO_BTC_MULTIPLIER } from './constants';

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;

interface Transaction {
    txid: string;
    version: number;
    locktime: number;
    vin: any[];  // You can replace `any[]` with a more specific type if needed
    vout: any[]; // You can replace `any[]` with a more specific type if needed
    size: number;
    weight: number;
    fee: number;
    status: {
        confirmed: boolean;
        block_height: number;
        block_hash: string;
        block_time: number;
    };
}

export default class AccountService {
    network: bitcoin.Network;

    constructor(isTestnet: boolean) {
        this.network = isTestnet ? TESTNET : MAINNET;
    }

    public async addressInfo(address: string, inSatoshis = true) {

        const url = `https://mempool.space${this.network == TESTNET ? '/testnet4' : ''}/api/address/${address}`;

        const response = await fetch(url);
        const result = await response.json();

        const data = result['chain_stats'];

        const totalRecieved = inSatoshis ? data.funded_txo_sum : data.funded_txo_sum * SATOSHI_TO_BTC_MULTIPLIER;
        const totalSent = inSatoshis ? data.spent_txo_sum : data.spent_txo_sum * SATOSHI_TO_BTC_MULTIPLIER;

        return {
            totalRecieved: totalRecieved,
            totalSent: totalSent,
            balance: totalRecieved - totalSent,
            txCount: data.tx_count,
        }

    }

    public async transactions(address: string, _limit = 50, _before: number | null = null): Promise<Transaction[]> {
        const url = `https://mempool.space${this.network == TESTNET ? '/testnet4' : ''}/api/address/${address}/txs`;

        console.log(url);

        const response = await fetch(url);
        const results = await response.json();
        console.log(results);
        return results;


    }


}