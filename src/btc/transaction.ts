/* eslint-disable @typescript-eslint/no-explicit-any */
import { ECPairFactory, ECPairInterface } from 'ecpair';

import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { BTC_TO_SATOSHI_MULTIPLIER } from './constants';
import { BtcBroadcastUnknownError } from './errors';
import type { IBroadcastCheck as BroadcastCheck } from './types';

const ECPair = ECPairFactory(ecc);

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;
const P2WPKH_INPUT_SIZE = 68;
const P2WPKH_OUTPUT_SIZE = 31;
// Conservative dust limit: change below this is folded into the fee rather
// than creating an output relay policy may reject.
const DUST_THRESHOLD = 546;
// A broadcast that has not answered by now is treated as unknown, not failed.
const BROADCAST_TIMEOUT_MS = 30_000;

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

  private _buildBroadcastResponse(
    success: boolean,
    result: string | null,
    error: string | null = null,
  ): BroadcastTxResponse {
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

  public async createTransaction(
    senderWif: string,
    recipientAddress: string,
    amount: number,
    feeRate = 0,
  ): Promise<CreateTxResponse> {
    const amountSats = Math.round(amount * BTC_TO_SATOSHI_MULTIPLIER);

    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      return this._buildCreateResponse(false, null, `Invalid amount: ${amount} BTC`);
    }

    const keyPair: ECPairInterface = ECPair.fromWIF(senderWif, this.network);

    const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: this.network });

    if (address == null) {
      return this._buildCreateResponse(false, null, 'Could not get address');
    }
    const utxos = await this.getUtxos(address);

    if (utxos.length === 0) {
      return this._buildCreateResponse(false, null, 'No UTXOs found for the given address.');
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

  /**
   * Broadcast a signed transaction. Repeating it with the same hex is safe:
   * a transaction the network already has is reported as accepted.
   *
   * Returns `success: false` only when the endpoint definitely did not take
   * the transaction (the node refused it, or the request was turned away
   * before reaching a node). When the request went out and no definite answer
   * came back, throws BtcBroadcastUnknownError: the transaction may be on the
   * network.
   */
  async broadcastTransaction(transactionHex: string): Promise<BroadcastTxResponse> {
    const txid = txidFromHex(transactionHex);
    if (!txid) {
      return this._buildBroadcastResponse(false, null, 'Error: not a valid signed transaction');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);
    let status: number;
    let body: string;
    try {
      const response = await fetch(`${this.apiBaseUrl}/tx`, {
        method: 'POST',
        body: transactionHex,
        headers: { 'Content-Type': 'text/plain' },
        signal: controller.signal,
      });
      status = response.status;
      body = await response.text();
    } catch (error) {
      throw new BtcBroadcastUnknownError(txid, transactionHex, error);
    } finally {
      clearTimeout(timer);
    }

    if (status >= 200 && status < 300) {
      return this._buildBroadcastResponse(true, txid, null);
    }

    switch (classifyBroadcastFailure(status, body)) {
      case 'already-known':
        return this._buildBroadcastResponse(true, txid, null);
      case 'refused':
        return this._buildBroadcastResponse(false, null, `Error: ${body}`);
      default:
        throw new BtcBroadcastUnknownError(txid, transactionHex, new Error(`HTTP ${status}: ${body}`));
    }
  }

  /**
   * Where a signed transaction stands on the network, for resolving a
   * BtcBroadcastUnknownError. Read-only; throws when the API cannot answer.
   *
   * - `found`: the transaction is in the mempool or a block.
   * - `conflicted`: an input is spent by a different transaction, so this one
   *   can never confirm.
   * - `absent`: not seen, every input still unspent. Re-broadcast the same
   *   hex; it may still reach the network.
   * - `unresolved`: an input is spent but the API does not say by what, so
   *   it cannot tell `found` from `conflicted`. Check again later.
   */
  async checkBroadcast(signedTxHex: string): Promise<BroadcastCheck> {
    let tx: bitcoin.Transaction;
    try {
      tx = bitcoin.Transaction.fromHex(signedTxHex);
    } catch (error) {
      throw new Error(`checkBroadcast: not a valid signed transaction: ${error}`);
    }
    const txid = tx.getId();

    const statusResponse = await fetch(`${this.apiBaseUrl}/tx/${txid}/status`);
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      return { state: 'found', txid, confirmed: status?.confirmed === true };
    }
    if (statusResponse.status !== 404) {
      throw new Error(`checkBroadcast: transaction status lookup failed: HTTP ${statusResponse.status}`);
    }

    const outspendsByTx = new Map<string, OutspendEntry[]>();
    let unresolved = false;
    for (const input of tx.ins) {
      // Input hashes are stored little-endian; txids are displayed reversed.
      const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
      let outspends = outspendsByTx.get(prevTxid);
      if (!outspends) {
        const response = await fetch(`${this.apiBaseUrl}/tx/${prevTxid}/outspends`);
        if (!response.ok) {
          throw new Error(`checkBroadcast: outspends lookup for ${prevTxid} failed: HTTP ${response.status}`);
        }
        outspends = (await response.json()) as OutspendEntry[];
        outspendsByTx.set(prevTxid, outspends);
      }

      const outspend = outspends[input.index];
      if (!outspend) {
        throw new Error(`checkBroadcast: no outspend entry for ${prevTxid}:${input.index}`);
      }
      if (!outspend.spent) continue;
      if (outspend.txid === txid) {
        return { state: 'found', txid, confirmed: outspend.status?.confirmed === true };
      }
      if (outspend.txid) {
        return { state: 'conflicted', txid, conflictingTxid: outspend.txid };
      }
      unresolved = true;
    }

    return unresolved ? { state: 'unresolved', txid } : { state: 'absent', txid };
  }
}

interface OutspendEntry {
  spent: boolean;
  txid?: string;
  status?: { confirmed?: boolean };
}

export function txidFromHex(hex: string): string | null {
  try {
    return bitcoin.Transaction.fromHex(hex).getId();
  } catch {
    return null;
  }
}

// Bitcoin Core sendrawtransaction error codes that mean the node looked at
// the transaction and did not take it: -22 decode failed, -25 missing or
// spent inputs, -26 rejected by policy or consensus.
const RPC_REFUSED_CODES = new Set([-22, -25, -26]);
// -27: the transaction (or its outputs) is already in the chain.
const RPC_ALREADY_IN_CHAIN = -27;
const ALREADY_KNOWN_TEXT =
  /already in (the )?block ?chain|outputs already in utxo set|txn-already-in-mempool|txn-already-known/i;

/**
 * Classify a non-2xx answer from a mempool.space/Esplora `POST /tx`.
 *
 * Those APIs answer every failed send with HTTP 400 and, when the node
 * replied, `sendrawtransaction RPC error: {"code":<n>,...}` (wrapped in
 * `{"error": ...}` when JSON is accepted). A 400 without a numeric node code,
 * or a 5xx, can mean the request reached the node and the reply was lost, so
 * it is unknown. Other 4xx statuses (auth, rate limit, wrong path, too large)
 * are turned away before any node sees the transaction.
 */
export function classifyBroadcastFailure(status: number, body: string): 'already-known' | 'refused' | 'unknown' {
  if (ALREADY_KNOWN_TEXT.test(body)) return 'already-known';

  const rpcCode = body.match(/RPC error[\s\S]*?\\?"code\\?"\s*:\s*(-?\d+)/);
  if (rpcCode) {
    const code = Number(rpcCode[1]);
    if (code === RPC_ALREADY_IN_CHAIN) return 'already-known';
    if (RPC_REFUSED_CODES.has(code)) return 'refused';
    return 'unknown';
  }

  if (status === 400 || status >= 500) return 'unknown';
  if (status >= 400) return 'refused';
  return 'unknown';
}
