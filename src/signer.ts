import base58 from 'bs58';
import { RESERVE_ADDRESS_PREFIX } from './constants';
import KeypairService from './services/keypair-service';
import { Keypair } from './types';
import { getSecureRandomBytes } from './utils';
import { sha256Hex as sha256HexOfUtf8 } from './crypto';

/**
 * The fields of a VFX transaction as they are signed. `Hash` is the digest
 * input (`signDigest` receives SHA-256 of it); a signer that wants to refuse
 * blind signing recomputes it from these fields with `transactionHash`, or
 * from `hashPreimage` with `hashPreimage()`.
 */
export interface SigningTransaction {
  Hash: string;
  FromAddress: string;
  ToAddress: string;
  TransactionType: number;
  Amount: number;
  Fee: number;
  Nonce: number;
  Timestamp: number;
  Data: unknown;
  UnlockTime: number | null;
}

interface SigningRequestBase {
  /**
   * The exact string the SDK signs. `signDigest` receives SHA-256 of it, so a
   * signer can check `sha256(message) === digestHex` before signing.
   */
  message: string;
  /**
   * Shared by every signature one user action needs (a vault creation signs
   * three messages, a multi-input withdrawal two plus one per input), so a
   * signer can approve the action once and sign its steps together.
   */
  flowId: string;
}

/**
 * What a signature is for, passed as the second argument of `signDigest`.
 * Signers that ignore it keep working: the digest is the same either way.
 */
export type SigningRequest =
  | (SigningRequestBase & {
      kind: 'transaction';
      transaction: SigningTransaction;
      /**
       * `Transaction.GetHashPreimage()` when the hash was computed or checked
       * locally; absent for prepared transactions whose builder did not
       * return one.
       */
      hashPreimage?: string;
      /** Who built the hash: the SDK, the Spyglass `/raw/hash` endpoint, or a prepare endpoint. */
      hashSource: 'local' | 'server' | 'prepared';
    })
  | (SigningRequestBase & {
      /** The owner's signature over the contract id, asking the node to push a vBTC vault's media to a beacon for `toAddress`. */
      kind: 'vbtc-beacon-upload';
      scIdentifier: string;
      toAddress: string;
    })
  | (SigningRequestBase & {
      kind: 'vbtc-ceremony';
      step: 'start' | 'share';
      ceremonyId: string;
      sessionId: string;
      ownerAddress: string;
      timestamp: number;
    })
  | (SigningRequestBase & {
      kind: 'vbtc-ownership';
      ownerAddress: string;
      name: string;
      description: string;
      ticker: string;
      ceremonyId: string;
      timestamp: number;
      uniqueId: string;
    })
  | (SigningRequestBase & {
      kind: 'frost-withdrawal';
      /** `input` is one per vault UTXO after the first (multi-input withdrawals). */
      step: 'start' | 'share' | 'input';
      scIdentifier: string;
      withdrawalRequestHash: string;
      ownerAddress: string;
      sessionId: string;
      timestamp: number;
      inputIndex?: number;
    })
  | (SigningRequestBase & {
      kind: 'reserve-recovery';
      reserveAddress: string;
      recoveryAddress: string;
      signatureTime: number;
    })
  | (SigningRequestBase & {
      /** The owner's signature over the contract id, asking the node to push the NFT's media to a beacon for `toAddress`. */
      kind: 'nft-beacon-upload';
      scIdentifier: string;
      toAddress: string;
    })
  | (SigningRequestBase & {
      /** The new owner's signature over the contract id, asking the node to fetch the NFT's media from its beacons. */
      kind: 'nft-beacon-download';
      scIdentifier: string;
      locators: string;
    })
  | (SigningRequestBase & {
      /** A proof that the signer owns the NFT, handed to someone who checks it with `verifyNftOwnership`. */
      kind: 'nft-ownership-proof';
      scIdentifier: string;
    })
  | (SigningRequestBase & {
      /** A Spyglass session token for the signer's address (needed to replace an NFT's media URLs). */
      kind: 'spyglass-auth';
    })
  | (SigningRequestBase & {
      kind: 'message';
    });

/**
 * One user action, shown to a person before anything time-sensitive is
 * built (ceremony and FROST messages carry timestamps, and a transaction
 * carries one too). Throwing from `approve` cancels the action; nothing is
 * signed or sent.
 */
export type SigningIntent =
  | {
      action: 'transaction';
      flowId: string;
      fromAddress: string;
      toAddress: string;
      amount: number;
      txType: number;
      data: unknown;
      unlockTime: number | null;
      /**
       * The fee the transaction will carry, and amount + fee: quoted before
       * approval and then used as-is. Absent when no quote was made
       * ('server' mode with a signer that has no `approve`).
       */
      fee?: number;
      total?: number;
    }
  | {
      action: 'vbtc-create';
      flowId: string;
      ownerAddress: string;
      name: string;
      description: string;
      ticker: string;
    }
  | {
      action: 'vbtc-withdrawal-complete';
      flowId: string;
      scIdentifier: string;
      ownerAddress: string;
      withdrawalRequestHash: string;
    }
  | {
      action: 'vbtc-transfer';
      flowId: string;
      scIdentifier: string;
      fromAddress: string;
      toAddress: string;
      amount: number;
    }
  | {
      /** Hand a vBTC vault (its contract and the right to withdraw) to another account. */
      action: 'vbtc-ownership-transfer';
      flowId: string;
      scIdentifier: string;
      fromAddress: string;
      toAddress: string;
    }
  | {
      /** A Type 27 request; the completion that follows (FROST and the Type 28 record) shares its flow. */
      action: 'vbtc-withdrawal-request';
      flowId: string;
      ownerAddress: string;
      btcAddress: string;
      amount: number;
      feeRate: number;
      inputs: Array<{ scIdentifier: string; amount: number }>;
    }
  | {
      action: 'vbtc-withdrawal-cancel';
      flowId: string;
      scIdentifier: string;
      ownerAddress: string;
      withdrawalRequestHash: string;
    }
  | {
      /** Recording (Type 28) a withdrawal whose Bitcoin transaction was already broadcast. */
      action: 'vbtc-withdrawal-record';
      flowId: string;
      scIdentifier: string;
      ownerAddress: string;
      withdrawalRequestHash: string;
      btcTransactionHash: string;
      amount: number;
      btcDestination: string;
    }
  | {
      /** One or more NFT mints (`mintNfts` approves the whole batch once). */
      action: 'nft-mint';
      flowId: string;
      minterAddress: string;
      names: string[];
    }
  | {
      action: 'nft-transfer';
      flowId: string;
      scIdentifier: string;
      fromAddress: string;
      toAddress: string;
      /** Hours a send from a vault waits before it settles; null from an ordinary account. */
      unlockHours: number | null;
    }
  | {
      action: 'nft-evolve';
      flowId: string;
      scIdentifier: string;
      minterAddress: string;
      ownerAddress: string;
      stage: number;
    }
  | {
      action: 'nft-burn';
      flowId: string;
      scIdentifier: string;
      ownerAddress: string;
    }
  | {
      action: 'reserve-recovery';
      flowId: string;
      reserveAddress: string;
      recoveryAddress: string;
    };

export interface SigningBatchItem {
  digestHex: string;
  request: SigningRequest;
}

/**
 * An external signing authority — an HSM, an MPC service, a hardware wallet,
 * a browser extension, or any process that holds the private key and must
 * never hand it to the SDK.
 *
 * Every message the SDK needs signed (a transaction hash, a ceremony message)
 * is hashed with SHA-256 exactly as `KeypairService.getSignature` does, and the
 * 32-byte digest is passed to `signDigest`. The signer returns a plain
 * DER-encoded secp256k1 ECDSA signature over that digest — the format every
 * KMS and HSM emits natively — and the SDK assembles the network's signature
 * string (`base64(DER).base58(publicKey)`) from it.
 *
 * High-s signatures are normalised to low-s before use, so a signer that does
 * not canonicalise (AWS KMS, for one) works unchanged.
 *
 * Everything past `signDigest(digestHex)` is optional: a signer written for
 * the one-argument form keeps compiling and behaving exactly as before.
 */
export interface Signer {
  /** The VFX address the signature will be verified against. */
  address: string;
  /** Uncompressed secp256k1 public key as hex, with or without the `04` prefix. */
  publicKey: string;
  /**
   * Sign the SHA-256 digest of a message. `digestHex` is the 32-byte digest as
   * 64 hex characters. Return the DER signature as bytes, hex, or base64.
   * `request` says what is being signed; see `SigningRequest`.
   */
  signDigest(digestHex: string, request?: SigningRequest): Promise<Uint8Array | string> | Uint8Array | string;
  /**
   * Sign several digests that belong to one user action, in order. Used for
   * multi-signature flows when present; otherwise `signDigest` is called once
   * per item. Return one DER signature per item, in the same order.
   */
  signBatch?(items: SigningBatchItem[]): Promise<Array<Uint8Array | string>>;
  /**
   * Called once per user action before anything time-sensitive is built, so a
   * person can approve first and the signing that follows needs no second
   * prompt. Throw to cancel.
   */
  approve?(intent: SigningIntent): Promise<void> | void;
}

/**
 * Anything the SDK can sign with: a local keypair or an external signer. A
 * ReserveKeypair is a Keypair whose address is the xRBX form, and resolves to
 * the vault; pass the reserve keypair object itself, not just its private
 * key, or the ordinary address of that key is what gets signed for.
 */
export type KeypairOrSigner = Keypair | Signer;

/**
 * What every signing path inside the SDK works against once the caller's
 * input has been resolved. `publicKey` is always without the `04` prefix,
 * which is the form the API's `public_key` fields and the signature suffix use.
 */
export interface ResolvedSigner {
  address: string;
  publicKey: string;
  sign(message: string, request?: SigningRequest): Promise<string>;
  /** Present when the underlying signer batches; use `signMessages` rather than calling it directly. */
  signBatch?(items: Array<{ message: string; request: SigningRequest }>): Promise<string[]>;
  approve?(intent: SigningIntent): Promise<void> | void;
}

/**
 * Sign the messages of one user action: in one `signBatch` call when the
 * signer has it, else one `sign` call each, in order.
 */
export async function signMessages(
  signer: ResolvedSigner,
  items: Array<{ message: string; request: SigningRequest }>,
): Promise<string[]> {
  if (signer.signBatch) {
    const signatures = await signer.signBatch(items);
    if (signatures.length !== items.length) {
      throw new Error(`Signer returned ${signatures.length} signatures for ${items.length} messages`);
    }
    return signatures;
  }
  const signatures: string[] = [];
  for (const item of items) {
    signatures.push(await signer.sign(item.message, item.request));
  }
  return signatures;
}

/** Ask the signer to approve a user action, when it wants to. */
export async function approveIntent(signer: ResolvedSigner, intent: SigningIntent): Promise<void> {
  await signer.approve?.(intent);
}

/** A fresh id for one user action's signatures. */
export function newFlowId(): string {
  return Buffer.from(getSecureRandomBytes(12)).toString('hex');
}

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const SECP256K1_HALF_N = SECP256K1_N >> BigInt(1);

export function isResolvedSigner(value: unknown): value is ResolvedSigner {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ResolvedSigner).sign === 'function' &&
    typeof (value as ResolvedSigner).address === 'string' &&
    typeof (value as ResolvedSigner).publicKey === 'string'
  );
}

export function isSigner(value: unknown): value is Signer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Signer).signDigest === 'function' &&
    typeof (value as Signer).address === 'string' &&
    typeof (value as Signer).publicKey === 'string'
  );
}

/**
 * Normalise an uncompressed public key to 128 hex characters (no `04`).
 * Throws on anything that is not a 64-byte uncompressed secp256k1 point.
 */
export function stripPublicKeyPrefix(publicKeyHex: string): string {
  const hex = publicKeyHex.trim().toLowerCase();
  const body = hex.length === 130 && hex.startsWith('04') ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{128}$/.test(body)) {
    throw new Error(
      `Invalid public key: expected an uncompressed secp256k1 key (128 hex chars, optional 04 prefix), got ${hex.length} chars`,
    );
  }
  return body;
}

export function sha256Hex(message: string): string {
  return sha256HexOfUtf8(message);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex.length === 0 ? BigInt(0) : BigInt('0x' + hex);
}

function bigIntToDerInteger(value: bigint): number[] {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) {
    hex = '0' + hex;
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  // DER integers are signed: a leading byte with the high bit set needs a
  // 0x00 pad so the value is not read as negative.
  if (bytes[0] & 0x80) {
    bytes.unshift(0x00);
  }
  return bytes;
}

/**
 * Parse a DER-encoded ECDSA signature into its (r, s) scalars. Strict: the
 * sequence must be exactly two positive integers in range for secp256k1 with
 * nothing trailing. secp256k1 signatures are at most 72 bytes, so long-form
 * lengths are rejected rather than parsed.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = 0;
  const readByte = (): number => {
    if (offset >= der.length) {
      throw new Error('Invalid DER signature: unexpected end of data');
    }
    return der[offset++];
  };
  const readLength = (): number => {
    const length = readByte();
    if (length & 0x80) {
      throw new Error('Invalid DER signature: long-form length is not valid for secp256k1');
    }
    return length;
  };
  const readInteger = (label: string): bigint => {
    if (readByte() !== 0x02) {
      throw new Error(`Invalid DER signature: expected INTEGER tag for ${label}`);
    }
    const length = readLength();
    if (length === 0 || offset + length > der.length) {
      throw new Error(`Invalid DER signature: bad length for ${label}`);
    }
    const value = bytesToBigInt(der.subarray(offset, offset + length));
    offset += length;
    if (value <= BigInt(0) || value >= SECP256K1_N) {
      throw new Error(`Invalid DER signature: ${label} is out of range for secp256k1`);
    }
    return value;
  };

  if (readByte() !== 0x30) {
    throw new Error('Invalid DER signature: expected SEQUENCE tag');
  }
  const sequenceLength = readLength();
  if (sequenceLength !== der.length - 2) {
    throw new Error('Invalid DER signature: sequence length does not match data');
  }
  const r = readInteger('r');
  const s = readInteger('s');
  if (offset !== der.length) {
    throw new Error('Invalid DER signature: trailing bytes');
  }
  return { r, s };
}

export function encodeDerSignature(r: bigint, s: bigint): Uint8Array {
  const rBytes = bigIntToDerInteger(r);
  const sBytes = bigIntToDerInteger(s);
  const body = [0x02, rBytes.length, ...rBytes, 0x02, sBytes.length, ...sBytes];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/**
 * Decode a signer's raw return value into DER bytes. Hex is recognised by
 * its character set and even length; DER always begins with 0x30, and the
 * base64 of any DER signature begins with "M", which is not a hex digit, so
 * the two forms cannot be confused.
 */
export function derSignatureToBytes(raw: Uint8Array | string): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Signer returned an empty signature');
  }
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(trimmed, 'hex'));
  }
  return Uint8Array.from(Buffer.from(trimmed, 'base64'));
}

/**
 * Assemble the network signature string from a DER signature and the
 * signer's public key: `base64(canonical DER).base58(publicKey)`. The s
 * value is forced low, matching what `KeypairService.getSignature` produces
 * and what the node's verifier accepts.
 */
export function vfxSignatureFromDer(der: Uint8Array | string, publicKeyHex: string): string {
  const { r, s } = parseDerSignature(derSignatureToBytes(der));
  const canonicalS = s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
  const canonicalDer = encodeDerSignature(r, canonicalS);
  const signatureBase64 = Buffer.from(canonicalDer).toString('base64');
  const publicKey = stripPublicKeyPrefix(publicKeyHex);
  return `${signatureBase64}.${base58.encode(Buffer.from(publicKey, 'hex'))}`;
}

/**
 * Resolve a caller-supplied keypair, bare private key, or external signer
 * into one object the SDK signs with.
 *
 * The address is always derived from the key and checked against what the
 * caller supplied: a keypair or signer whose address does not belong to its
 * key would produce transactions the node rejects, and a mismatch usually
 * means the wrong key (or the wrong network) was wired up.
 */
export function resolveSigner(
  input: KeypairOrSigner | { privateKey: string } | ResolvedSigner,
  keypairService: KeypairService,
): ResolvedSigner {
  if (isResolvedSigner(input)) {
    return input;
  }
  if (isSigner(input)) {
    const publicKey = stripPublicKeyPrefix(input.publicKey);
    // A reserve (vault) signer presents its xRBX address; the same key also
    // has an ordinary address, so which one is meant is read off the prefix.
    const derivedAddress = input.address.startsWith(RESERVE_ADDRESS_PREFIX)
      ? keypairService.reserveAddressFromPublic(publicKey)
      : keypairService.addressFromPublic(publicKey);
    if (input.address !== derivedAddress) {
      throw new Error(
        `Signer address ${input.address} does not match its public key (which derives ${derivedAddress} on this network)`,
      );
    }
    const signDigest = input.signDigest.bind(input);
    const signBatch = input.signBatch?.bind(input);
    const approve = input.approve?.bind(input);
    return {
      address: derivedAddress,
      publicKey,
      // A request is passed only when there is one, so a signer that counts
      // its arguments sees exactly the call it saw before requests existed.
      sign: async (message: string, request?: SigningRequest): Promise<string> => {
        const digest = sha256Hex(message);
        const raw = await (request === undefined ? signDigest(digest) : signDigest(digest, request));
        return vfxSignatureFromDer(raw, publicKey);
      },
      ...(signBatch && {
        signBatch: async (items: Array<{ message: string; request: SigningRequest }>): Promise<string[]> => {
          const raws = await signBatch(
            items.map((item) => ({ digestHex: sha256Hex(item.message), request: item.request })),
          );
          if (!Array.isArray(raws) || raws.length !== items.length) {
            throw new Error(`Signer.signBatch returned ${raws?.length} signatures for ${items.length} digests`);
          }
          return raws.map((raw) => vfxSignatureFromDer(raw, publicKey));
        },
      }),
      ...(approve && { approve }),
    };
  }

  const privateKey = (input as { privateKey?: string }).privateKey;
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw new Error('A keypair with a privateKey or a Signer with signDigest() is required');
  }
  const suppliedAddress = (input as { address?: string }).address;
  const address = suppliedAddress?.startsWith(RESERVE_ADDRESS_PREFIX)
    ? keypairService.reserveAddressFromPrivate(privateKey)
    : keypairService.addressFromPrivate(privateKey);
  if (suppliedAddress && suppliedAddress !== address) {
    throw new Error(
      `Keypair address ${suppliedAddress} does not match its private key (which derives ${address} on this network)`,
    );
  }
  return {
    address,
    publicKey: stripPublicKeyPrefix(keypairService.publicFromPrivate(privateKey)),
    sign: async (message: string): Promise<string> => keypairService.getSignature(message, privateKey),
  };
}
