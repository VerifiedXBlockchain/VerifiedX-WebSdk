/* eslint-disable @typescript-eslint/no-explicit-any */
import { ECPairFactory, ECPairInterface } from 'ecpair';

import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { BTC_TO_SATOSHI_MULTIPLIER, defaultApiBaseUrl } from './constants';
import { BtcBroadcastUnknownError } from './errors';
import type { IBroadcastCheck as BroadcastCheck, IBtcQuoteUtxo, IBtcSendQuote } from './types';
import { BtcSigner, assertBtcSignerAddress } from './signer';
import { BtcSpendType, addressForSpendType, toXOnly } from './address-types';
import { planBtcPayment } from './payment-plan';
import { quoteBtcPayment, recipientScriptLength } from './quote';
import { newFlowId } from '../signer';

const ECPair = ECPairFactory(ecc);

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;
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
    // Overridable so an API outage or a testnet chain change doesn't
    // require an SDK release.
    this.apiBaseUrl = apiBaseUrl ?? defaultApiBaseUrl(isTestnet);
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
    options: { addressType?: BtcSpendType } = {},
  ): Promise<CreateTxResponse> {
    const keyPair: ECPairInterface = ECPair.fromWIF(senderWif, this.network);
    const spendType = options.addressType ?? 'p2wpkh';

    const address = addressForSpendType(keyPair.publicKey, spendType, this.network);

    if (address == null) {
      return this._buildCreateResponse(false, null, 'Could not get address');
    }

    const built = await this.buildPayment(address, recipientAddress, amount, feeRate, {
      type: spendType,
      pubkey: keyPair.publicKey,
    });
    if (!built.psbt) {
      return this._buildCreateResponse(false, null, built.error);
    }
    const psbt = built.psbt;

    // A BIP 86 Taproot spend signs with the key tweaked by its own x-only
    // public key (no script tree). The SDK's own `p2tr` address uses the key
    // itself as the output key, so it signs untweaked, like every other type.
    const signingKey =
      spendType === 'p2tr-bip86'
        ? keyPair.tweak(bitcoin.crypto.taggedHash('TapTweak', toXOnly(keyPair.publicKey)))
        : keyPair;
    psbt.signAllInputs(signingKey);
    psbt.finalizeAllInputs();

    const transactionHex = psbt.extractTransaction().toHex();

    return this._buildCreateResponse(true, transactionHex, null);
  }

  /**
   * `createTransaction` with a BtcSigner instead of a WIF: the same PSBT is
   * built and handed to `signer.signPsbt` with a `btc-transaction` request.
   * The returned PSBT must be the same transaction with every input signed
   * by `signer.publicKey`; anything else is refused before it can be
   * broadcast. The signer's `approve` runs first when it has one.
   */
  public async createTransactionWithSigner(
    signer: BtcSigner,
    recipientAddress: string,
    amount: number,
    feeRate = 0,
    flowId: string = newFlowId(),
  ): Promise<CreateTxResponse> {
    const pubkey = assertBtcSignerAddress(signer, this.network);
    const spendType = signer.addressType ?? 'p2wpkh';
    const amountSats = Math.round(amount * BTC_TO_SATOSHI_MULTIPLIER);
    await signer.approve?.({
      action: 'btc-send',
      flowId,
      fromAddress: signer.address,
      toAddress: recipientAddress,
      amountSats,
      feeRate,
    });

    const built = await this.buildPayment(signer.address, recipientAddress, amount, feeRate, {
      type: spendType,
      pubkey,
    });
    if (!built.psbt) {
      return this._buildCreateResponse(false, null, built.error);
    }
    const psbt = built.psbt;
    const psbtBase64 = psbt.toBase64();
    const returned = await signer.signPsbt(psbtBase64, {
      kind: 'btc-transaction',
      flowId,
      network: this.network === TESTNET ? 'testnet' : 'mainnet',
      fromAddress: signer.address,
      addressType: spendType,
      inputs: built.inputs,
      outputs: built.outputs,
      feeSats: built.feeSats,
      feeRate: built.feeRate,
      psbtBase64,
    });

    const signed = parsePsbt(returned, this.network);
    const problem = sameTransactionProblem(psbt, signed) ?? sameSpentOutputsProblem(psbt, signed);
    if (problem) {
      return this._buildCreateResponse(false, null, `BtcSigner returned a different transaction: ${problem}`);
    }
    for (let index = 0; index < signed.data.inputs.length; index++) {
      const input = signed.data.inputs[index];
      if (spendType !== 'p2wpkh') {
        // Finalized inputs are checked only for P2WPKH; other types must come
        // back with their signatures still partial, so they can be verified.
        if (input.finalScriptWitness || input.finalScriptSig) {
          return this._buildCreateResponse(
            false,
            null,
            `BtcSigner finalized input ${index}; return ${spendType} inputs unfinalized`,
          );
        }
        const valid =
          spendType === 'p2tr' || spendType === 'p2tr-bip86'
            ? !!input.tapKeySig &&
              (input.tapKeySig.length === 64 || input.tapKeySig[64] === bitcoin.Transaction.SIGHASH_ALL) &&
              signed.validateSignaturesOfInput(index, schnorrValidator)
            : !!input.partialSig?.some(
                (sig) =>
                  sig.pubkey.equals(pubkey) &&
                  bitcoin.script.signature.decode(sig.signature).hashType === bitcoin.Transaction.SIGHASH_ALL,
              ) && signed.validateSignaturesOfInput(index, ecdsaValidator, pubkey);
        if (!valid) {
          return this._buildCreateResponse(false, null, `BtcSigner did not sign input ${index} with its key`);
        }
        signed.finalizeInput(index);
        continue;
      }
      if (input.finalScriptWitness) {
        if (!finalWitnessIsValid(signed, index, pubkey)) {
          return this._buildCreateResponse(false, null, `BtcSigner input ${index} is not signed by its key`);
        }
        continue;
      }
      const partial = input.partialSig?.find((sig) => sig.pubkey.equals(pubkey));
      const sighashAll =
        !!partial && bitcoin.script.signature.decode(partial.signature).hashType === bitcoin.Transaction.SIGHASH_ALL;
      if (!partial || !sighashAll || !signed.validateSignaturesOfInput(index, ecdsaValidator, pubkey)) {
        return this._buildCreateResponse(false, null, `BtcSigner did not sign input ${index} with its key`);
      }
      signed.finalizeInput(index);
    }

    return this._buildCreateResponse(true, signed.extractTransaction().toHex(), null);
  }

  /**
   * The unsigned P2WPKH payment from `address`: every UTXO in, `amount` to
   * the recipient, change back when it is worth keeping. Shared by the WIF
   * and BtcSigner paths so both build the same transaction.
   */
  private async buildPayment(
    address: string,
    recipientAddress: string,
    amount: number,
    feeRate: number,
    spend: { type: BtcSpendType; pubkey: Buffer } = { type: 'p2wpkh', pubkey: Buffer.alloc(0) },
  ): Promise<
    | {
        psbt: bitcoin.Psbt;
        inputs: Array<{ txid: string; vout: number; valueSats: number }>;
        outputs: Array<{ address: string; valueSats: number; isChange: boolean }>;
        feeSats: number;
        feeRate: number;
        error: null;
      }
    | { psbt: null; error: string }
  > {
    const amountSats = Math.round(amount * BTC_TO_SATOSHI_MULTIPLIER);

    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      return { psbt: null, error: `Invalid amount: ${amount} BTC` };
    }

    const utxos = await this.getUtxos(address);

    if (utxos.length === 0) {
      return { psbt: null, error: 'No UTXOs found for the given address.' };
    }

    feeRate = await this.resolveFeeRate(feeRate);

    const psbt = new bitcoin.Psbt({ network: this.network });
    const inputs: Array<{ txid: string; vout: number; valueSats: number }> = [];
    const outputs: Array<{ address: string; valueSats: number; isChange: boolean }> = [];

    let inputSum = 0;

    const outputScript = bitcoin.address.toOutputScript(address, this.network);
    for (const utxo of utxos as any[]) {
      const base = { hash: utxo.txid, index: utxo.vout, sequence: 0xfffffffd };
      const witnessUtxo = { script: outputScript, value: utxo.value }; // satoshis
      switch (spend.type) {
        case 'p2wpkh':
          psbt.addInput({ ...base, witnessUtxo });
          break;
        case 'p2sh-p2wpkh':
          psbt.addInput({
            ...base,
            witnessUtxo,
            redeemScript: bitcoin.payments.p2wpkh({ pubkey: spend.pubkey, network: this.network }).output,
          });
          break;
        case 'p2pkh': {
          // A legacy input signs over the whole previous transaction, not the
          // amount, so the amount the change is computed from is read from
          // that transaction: an API reporting less would otherwise turn the
          // difference into fee. A mismatch stops the payment.
          const previous = await this.getRawTx(utxo.txid);
          const previousTx = bitcoin.Transaction.fromBuffer(previous);
          if (previousTx.getId() !== utxo.txid) {
            return { psbt: null, error: `The previous transaction for ${utxo.txid} does not match its id` };
          }
          const spent = previousTx.outs[utxo.vout];
          if (!spent || spent.value !== utxo.value || !spent.script.equals(outputScript)) {
            return {
              psbt: null,
              error: `UTXO ${utxo.txid}:${utxo.vout} does not match its previous transaction (amount or script)`,
            };
          }
          psbt.addInput({ ...base, nonWitnessUtxo: previous });
          break;
        }
        case 'p2tr':
          // The output key is the key itself. bitcoinjs signs a key-path input
          // only when it carries tapInternalKey, and signs with whichever key
          // matches the output key, which here is the untweaked key.
          psbt.addInput({ ...base, witnessUtxo, tapInternalKey: toXOnly(spend.pubkey) });
          break;
        case 'p2tr-bip86':
          psbt.addInput({ ...base, witnessUtxo, tapInternalKey: toXOnly(spend.pubkey) });
          break;
      }
      inputs.push({ txid: utxo.txid, vout: utxo.vout, valueSats: utxo.value });
      inputSum += utxo.value;
    }

    psbt.addOutput({
      address: recipientAddress,
      value: amountSats,
    });
    outputs.push({ address: recipientAddress, valueSats: amountSats, isChange: false });

    const plan = planBtcPayment({
      spendType: spend.type,
      inputCount: inputs.length,
      inputSum,
      amountSats,
      feeRate,
      recipientScriptLength: recipientScriptLength(spend.type, recipientAddress, this.network),
    });

    if (!plan.sufficient) {
      return {
        psbt: null,
        error:
          `Insufficient funds: inputs total ${inputSum} sats, need ${plan.requiredSats} sats ` +
          `(${amountSats} + ${plan.feeSats} fee at ${feeRate} sat/vB)`,
      };
    }
    if (plan.hasChange) {
      psbt.addOutput({
        address: address,
        value: plan.changeSats,
      });
      outputs.push({ address, valueSats: plan.changeSats, isChange: true });
    }

    const feeSats = inputSum - outputs.reduce((sum, output) => sum + output.valueSats, 0);
    return { psbt, inputs, outputs, feeSats, feeRate, error: null };
  }

  /** The fee rate a payment uses: the one given, or the economy rate (with a fixed fallback) when 0. */
  private async resolveFeeRate(feeRate: number): Promise<number> {
    if (feeRate) return feeRate;
    const feeRates = await this.getFeeRates();
    return feeRates?.economyFee || (this.network == TESTNET ? 2 : 5);
  }

  /**
   * What paying `amountSats` from `fromAddress` (spending as `spendType`)
   * would cost, before anything is signed or broadcast. Reads the address's
   * UTXOs (and the recommended fee rates when `feeRate` is 0) and nothing
   * else; it spends every UTXO, as `buildPayment` does, and uses the same
   * arithmetic, so a send built from the same UTXOs and fee rate pays exactly
   * `feeSats`. A P2PKH send also checks each UTXO against its previous
   * transaction and stops on a mismatch; the quote does not fetch those.
   * With `utxos`, those coins are quoted and the address's UTXOs are not
   * fetched. The arithmetic is `quoteBtcPayment`'s.
   */
  public async quoteTransaction(
    fromAddress: string,
    spendType: BtcSpendType,
    recipientAddress: string,
    amountSats: number,
    feeRate = 0,
    utxos?: ReadonlyArray<IBtcQuoteUtxo>,
  ): Promise<IBtcSendQuote> {
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
      throw new Error(`quoteTransaction: amountSats must be a positive whole number of satoshis, got ${amountSats}`);
    }
    if (!Number.isFinite(feeRate) || feeRate < 0) {
      throw new Error(`quoteTransaction: invalid feeRate ${feeRate}`);
    }
    bitcoin.address.toOutputScript(fromAddress, this.network);
    recipientScriptLength(spendType, recipientAddress, this.network);
    const coins = utxos ?? ((await this.getUtxos(fromAddress)) as IBtcQuoteUtxo[]);
    const resolvedFeeRate = await this.resolveFeeRate(feeRate);
    const quote = quoteBtcPayment({
      utxos: coins,
      spendType,
      recipientAddress,
      amountSats,
      feeRate: resolvedFeeRate,
      network: this.network,
    });
    return { ...quote, fromAddress, recipientAddress };
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

const ecdsaValidator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
  ecc.verify(msghash, pubkey, signature);

const schnorrValidator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
  ecc.verifySchnorr(msghash, pubkey, signature);

/** A PSBT from a signer, which may answer in base64 or hex. */
function parsePsbt(text: string, network: bitcoin.Network): bitcoin.Psbt {
  const trimmed = String(text ?? '').trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return bitcoin.Psbt.fromHex(trimmed, { network });
  }
  return bitcoin.Psbt.fromBase64(trimmed, { network });
}

/** Why `signed` is not the transaction `built` asked to be signed, or null. */
function sameTransactionProblem(built: bitcoin.Psbt, signed: bitcoin.Psbt): string | null {
  if (signed.version !== built.version || signed.locktime !== built.locktime) return 'version or locktime';
  if (signed.txInputs.length !== built.txInputs.length) return 'input count';
  if (signed.txOutputs.length !== built.txOutputs.length) return 'output count';
  for (let i = 0; i < built.txInputs.length; i++) {
    const a = built.txInputs[i];
    const b = signed.txInputs[i];
    if (!a.hash.equals(b.hash) || a.index !== b.index || a.sequence !== b.sequence) return `input ${i}`;
  }
  for (let i = 0; i < built.txOutputs.length; i++) {
    const a = built.txOutputs[i];
    const b = signed.txOutputs[i];
    if (!a.script.equals(b.script) || a.value !== b.value) return `output ${i}`;
  }
  return null;
}

/**
 * Why the outputs `signed` claims to spend differ from the ones `built`
 * spends, or null. A signature commits to the spent amount, so a signer that
 * changed `witnessUtxo` could sign a hash that verifies against its own
 * amount while the network, which uses the real one, refuses it. The
 * SDK's own amounts and scripts are what the signatures are checked against.
 */
function sameSpentOutputsProblem(built: bitcoin.Psbt, signed: bitcoin.Psbt): string | null {
  for (let i = 0; i < built.data.inputs.length; i++) {
    const builtInput = built.data.inputs[i];
    const signedInput = signed.data.inputs[i];
    if (builtInput.witnessUtxo) {
      const a = builtInput.witnessUtxo;
      const b = signedInput.witnessUtxo;
      if (!b || a.value !== b.value || !a.script.equals(b.script)) return `spent output of input ${i}`;
    } else if (builtInput.nonWitnessUtxo) {
      // A legacy input commits to the whole previous transaction.
      const b = signedInput.nonWitnessUtxo;
      if (!b || !builtInput.nonWitnessUtxo.equals(b)) return `spent output of input ${i}`;
    }
    if (
      (builtInput.redeemScript || signedInput.redeemScript) &&
      !(builtInput.redeemScript && signedInput.redeemScript && builtInput.redeemScript.equals(signedInput.redeemScript))
    ) {
      return `redeem script of input ${i}`;
    }
  }
  return null;
}

/** A finalized P2WPKH input: the witness must be [signature, pubkey] for our key and verify. */
function finalWitnessIsValid(psbt: bitcoin.Psbt, index: number, pubkey: Buffer): boolean {
  const input = psbt.data.inputs[index];
  const witnessUtxo = input.witnessUtxo;
  if (!input.finalScriptWitness || !witnessUtxo) return false;
  // finalScriptWitness is a serialized witness vector: item count, then
  // length-prefixed items. A P2WPKH spend has exactly two items, each
  // shorter than 0xfd bytes, so single-byte lengths suffice.
  const raw = input.finalScriptWitness;
  const items: Buffer[] = [];
  let offset = 0;
  const count = raw[offset++];
  for (let i = 0; i < count && offset < raw.length; i++) {
    const length = raw[offset++];
    items.push(raw.subarray(offset, offset + length));
    offset += length;
  }
  if (count !== 2 || items.length !== 2 || offset !== raw.length || !items[1].equals(pubkey)) return false;
  const decoded = bitcoin.script.signature.decode(items[0]);
  const scriptCode = bitcoin.payments.p2pkh({ pubkey }).output as Buffer;
  const unsigned = bitcoin.Transaction.fromBuffer(
    (psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer }).toBuffer(),
  );
  const hash = unsigned.hashForWitnessV0(index, scriptCode, witnessUtxo.value, decoded.hashType);
  return decoded.hashType === bitcoin.Transaction.SIGHASH_ALL && ecc.verify(hash, pubkey, decoded.signature);
}
