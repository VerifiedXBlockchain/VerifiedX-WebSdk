import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import { derSignatureToBytes, encodeDerSignature, newFlowId, parseDerSignature } from '../signer';
import { BtcSpendType, addressForSpendType, toXOnly } from './address-types';

const ECPair = ECPairFactory(ecc);
const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const SECP256K1_HALF_N = SECP256K1_N >> BigInt(1);

/**
 * The Bitcoin side of the SDK's external-signer seam (see `Signer` for the
 * VFX side). A BtcSigner holds a key for one native SegWit (P2WPKH) address
 * and never hands it to the SDK: the SDK builds the transaction as a PSBT and
 * the signer signs it, or the SDK hands it a message digest. A browser
 * extension, hardware wallet or HSM implements this.
 *
 * Every argument past the first is optional context: a signer that ignores
 * `request` still works.
 */
export interface BtcSigner {
  /**
   * The address the key spends from, checked against `publicKey`: its P2WPKH
   * (bc1q / tb1q) address unless `addressType` says otherwise.
   */
  address: string;
  /**
   * Which of the key's addresses `address` is: 'p2wpkh' (default),
   * 'p2sh-p2wpkh', 'p2pkh' or key-path 'p2tr'. Inputs of the last three must
   * come back from `signPsbt` with their signatures still partial
   * (`partialSig`, or `tapKeySig` for Taproot) so the SDK can verify them.
   */
  addressType?: BtcSpendType;
  /** Compressed secp256k1 public key, 33 bytes as hex. */
  publicKey: string;
  /**
   * Sign every input of a PSBT that spends from `address` and return the
   * PSBT (base64 or hex), finalized or not. The SDK checks the result is the
   * same transaction, verifies each signature against `publicKey`, finalizes
   * it if needed, and only then broadcasts.
   */
  signPsbt(psbtBase64: string, request?: BtcSigningRequest): Promise<string> | string;
  /**
   * Sign a message digest (double SHA-256 of the UTF-8 message, as hex) and
   * return a DER signature as bytes, hex or base64. Needed only for the
   * message flows (.btc name claims and transfer acceptances).
   */
  signDigest?(digestHex: string, request?: BtcSigningRequest): Promise<Uint8Array | string> | Uint8Array | string;
  /** Called once per user action before anything is built. Throw to cancel. */
  approve?(intent: BtcSigningIntent): Promise<void> | void;
}

/** What a BtcSigner is asked to sign. */
export type BtcSigningRequest =
  | {
      kind: 'btc-transaction';
      flowId: string;
      network: 'mainnet' | 'testnet';
      fromAddress: string;
      /** The type of `fromAddress`; absent means 'p2wpkh'. */
      addressType?: BtcSpendType;
      inputs: Array<{ txid: string; vout: number; valueSats: number }>;
      /** Every output, the change back to `fromAddress` marked `isChange`. */
      outputs: Array<{ address: string; valueSats: number; isChange: boolean }>;
      feeSats: number;
      feeRate: number;
      psbtBase64: string;
    }
  | {
      kind: 'btc-message';
      flowId: string;
      /** The exact text signed; the digest is double SHA-256 of its UTF-8 bytes. */
      message: string;
      /** Why it is signed, so a signer can show it. */
      purpose: 'btc-name-claim' | 'btc-name-transfer-acceptance' | 'message';
    };

/** One Bitcoin user action, shown before anything is built. */
export type BtcSigningIntent =
  | {
      action: 'btc-send';
      flowId: string;
      fromAddress: string;
      toAddress: string;
      amountSats: number;
      /** sat/vB; 0 means the SDK picks the economy rate. */
      feeRate: number;
    }
  | {
      action: 'btc-message';
      flowId: string;
      address: string;
      message: string;
      purpose: 'btc-name-claim' | 'btc-name-transfer-acceptance' | 'message';
    };

export function isBtcSigner(value: unknown): value is BtcSigner {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BtcSigner).signPsbt === 'function' &&
    typeof (value as BtcSigner).address === 'string' &&
    typeof (value as BtcSigner).publicKey === 'string'
  );
}

/**
 * Throws unless `signer.address` is the `signer.addressType` (default P2WPKH)
 * address of `signer.publicKey` on `network`.
 */
export function assertBtcSignerAddress(signer: BtcSigner, network: bitcoin.Network): Buffer {
  const pubkey = Buffer.from(signer.publicKey, 'hex');
  if (pubkey.length !== 33 || !ecc.isPoint(pubkey)) {
    throw new Error('BtcSigner.publicKey must be a 33-byte compressed secp256k1 key as hex');
  }
  const derived = addressForSpendType(pubkey, signer.addressType ?? 'p2wpkh', network);
  if (derived !== signer.address) {
    throw new Error(
      `BtcSigner address ${signer.address} does not match its public key (which derives ${derived} on this network)`,
    );
  }
  return pubkey;
}

/** A DER signature with s forced low, as hex: the form the SDK's local key produces. */
export function canonicalDerHex(raw: Uint8Array | string): string {
  const { r, s } = parseDerSignature(derSignatureToBytes(raw));
  const lowS = s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
  return Buffer.from(encodeDerSignature(r, lowS)).toString('hex');
}

/** Double SHA-256 of a UTF-8 message, as hex: the digest the BTC message signature covers. */
export function btcMessageDigest(message: string): string {
  return bitcoin.crypto.hash256(Buffer.from(message, 'utf8')).toString('hex');
}

/**
 * Sign a message with a BtcSigner in the SDK's BTC message format
 * (`<DER hex>.<compressed public key hex>`), the same as
 * `BtcClient.getSignature` with the key itself. The signature is checked
 * against the signer's public key before it is returned.
 */
export async function signBtcMessage(
  signer: BtcSigner,
  message: string,
  network: bitcoin.Network,
  purpose: 'btc-name-claim' | 'btc-name-transfer-acceptance' | 'message' = 'message',
  flowId: string = newFlowId(),
): Promise<string> {
  if (typeof signer.signDigest !== 'function') {
    throw new Error('This BtcSigner cannot sign messages (it has no signDigest)');
  }
  const pubkey = assertBtcSignerAddress(signer, network);
  const digestHex = btcMessageDigest(message);
  const derHex = canonicalDerHex(await signer.signDigest(digestHex, { kind: 'btc-message', flowId, message, purpose }));
  const compact = bitcoin.script.signature.decode(
    Buffer.concat([Buffer.from(derHex, 'hex'), Buffer.from([bitcoin.Transaction.SIGHASH_ALL])]),
  ).signature;
  if (!ecc.verify(Buffer.from(digestHex, 'hex'), pubkey, compact)) {
    throw new Error('BtcSigner returned a message signature that does not verify against its public key');
  }
  return `${derHex}.${signer.publicKey.toLowerCase()}`;
}

/**
 * A bitcoinjs network from a real one, a name, or the browser namespace's
 * `networks` placeholders (`{ name: 'testnet' }`), which carry no
 * parameters of their own.
 */
function resolveBitcoinNetwork(network: bitcoin.Network | 'mainnet' | 'testnet' | { name: string }): bitcoin.Network {
  if (typeof network === 'object' && 'bech32' in network) {
    return network as bitcoin.Network;
  }
  const name = typeof network === 'string' ? network : network.name;
  if (name === 'testnet') return bitcoin.networks.testnet;
  if (name === 'mainnet' || name === 'bitcoin') return bitcoin.networks.bitcoin;
  if (name === 'regtest') return bitcoin.networks.regtest;
  throw new Error(`Unknown Bitcoin network: ${String(name)}`);
}

/**
 * A BtcSigner backed by a local key (WIF), for in-memory wallets and tests.
 * Signs exactly as the SDK's key-based paths do. `networkOrName` is a
 * bitcoinjs network, 'mainnet' / 'testnet', or one of the browser
 * namespace's `btc.networks` values.
 */
export function btcSignerFromWif(
  wif: string,
  networkOrName: bitcoin.Network | 'mainnet' | 'testnet' | { name: string },
  addressType: BtcSpendType = 'p2wpkh',
): BtcSigner {
  const network = resolveBitcoinNetwork(networkOrName);
  const keyPair = ECPair.fromWIF(wif, network);
  const address = addressForSpendType(keyPair.publicKey, addressType, network) as string;
  // A BIP 86 key path signs with the key tweaked by its own x-only key.
  const psbtKey =
    addressType === 'p2tr-bip86'
      ? keyPair.tweak(bitcoin.crypto.taggedHash('TapTweak', toXOnly(keyPair.publicKey)))
      : keyPair;
  return {
    address,
    publicKey: keyPair.publicKey.toString('hex'),
    ...(addressType !== 'p2wpkh' && { addressType }),
    signPsbt: (psbtBase64: string) => {
      const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
      psbt.signAllInputs(psbtKey);
      return psbt.toBase64();
    },
    signDigest: (digestHex: string) => {
      const compact = Buffer.from(keyPair.sign(Buffer.from(digestHex, 'hex')));
      return encodeDerSignature(
        BigInt('0x' + compact.subarray(0, 32).toString('hex')),
        BigInt('0x' + compact.subarray(32, 64).toString('hex')),
      );
    },
  };
}
