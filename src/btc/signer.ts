import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import { derSignatureToBytes, encodeDerSignature, newFlowId, parseDerSignature } from '../signer';

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
  /** The P2WPKH (bc1q / tb1q) address the key controls. Checked against `publicKey`. */
  address: string;
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

/** Throws unless `signer.address` is the P2WPKH address of `signer.publicKey` on `network`. */
export function assertBtcSignerAddress(signer: BtcSigner, network: bitcoin.Network): Buffer {
  const pubkey = Buffer.from(signer.publicKey, 'hex');
  if (pubkey.length !== 33 || !ecc.isPoint(pubkey)) {
    throw new Error('BtcSigner.publicKey must be a 33-byte compressed secp256k1 key as hex');
  }
  const derived = bitcoin.payments.p2wpkh({ pubkey, network }).address;
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
 * A BtcSigner backed by a local key (WIF), for in-memory wallets and tests.
 * Signs exactly as the SDK's key-based paths do.
 */
export function btcSignerFromWif(wif: string, network: bitcoin.Network): BtcSigner {
  const keyPair = ECPair.fromWIF(wif, network);
  const address = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address as string;
  return {
    address,
    publicKey: keyPair.publicKey.toString('hex'),
    signPsbt: (psbtBase64: string) => {
      const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
      psbt.signAllInputs(keyPair);
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
