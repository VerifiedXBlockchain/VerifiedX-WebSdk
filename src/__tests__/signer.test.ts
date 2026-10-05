import EC from 'elliptic';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import {
  Signer,
  encodeDerSignature,
  isSigner,
  parseDerSignature,
  resolveSigner,
  sha256Hex,
  stripPublicKeyPrefix,
  vfxSignatureFromDer,
} from '../signer';

const curve = new EC.ec('secp256k1');
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const publicKey = keypairService.publicFromPrivate(privateKey); // 04-prefixed
const address = keypairService.addressFromPrivate(privateKey);

/**
 * Stand-in for an HSM: holds the key, signs a digest, returns DER. Built on
 * elliptic with RFC6979 so its output is deterministic and can be compared
 * byte-for-byte with KeypairService.getSignature.
 */
function hsmSignDigest(digestHex: string, options: { canonical: boolean } = { canonical: true }): Uint8Array {
  const keyPair = curve.keyFromPrivate(Buffer.from(privateKey, 'hex'));
  const signature = keyPair.sign(Buffer.from(digestHex, 'hex'), { canonical: options.canonical });
  return Uint8Array.from(signature.toDER());
}

function makeSigner(overrides: Partial<Signer> = {}): Signer {
  return {
    address,
    publicKey,
    signDigest: (digestHex) => hsmSignDigest(digestHex),
    ...overrides,
  };
}

describe('KeypairService.addressFromPublic', () => {
  test('matches addressFromPrivate for the same key, with or without the 04 prefix', () => {
    expect(keypairService.addressFromPublic(publicKey)).toBe(address);
    expect(keypairService.addressFromPublic(publicKey.slice(2))).toBe(address);
  });

  test('is network-aware', () => {
    const mainnet = new KeypairService(Network.Mainnet);
    expect(mainnet.addressFromPublic(publicKey)).not.toBe(address);
    expect(mainnet.addressFromPublic(publicKey)).toBe(mainnet.addressFromPrivate(privateKey));
  });

  test('rejects malformed keys', () => {
    expect(() => keypairService.addressFromPublic('04abcd')).toThrow(/Invalid public key/);
    expect(() => keypairService.addressFromPublic('zz'.repeat(64))).toThrow(/Invalid public key/);
  });
});

describe('DER helpers', () => {
  test('encode/parse round-trips and pads high-bit integers', () => {
    const r = BigInt('0x' + 'ff'.repeat(32).replace(/^ff/, '7f'));
    const s = BigInt('0x' + '80' + '11'.repeat(31));
    const der = encodeDerSignature(r, s);
    expect(der[0]).toBe(0x30);
    const parsed = parseDerSignature(der);
    expect(parsed.r).toBe(r);
    expect(parsed.s).toBe(s);
    // s has its high bit set, so DER must have padded it to 33 bytes.
    expect(der[der.length - 33 - 2 + 1]).toBe(33);
  });

  test('rejects trailing bytes, wrong tags and out-of-range scalars', () => {
    const good = hsmSignDigest(sha256Hex('m'));
    expect(() => parseDerSignature(Uint8Array.from([...good, 0x00]))).toThrow(/sequence length/);
    const badTag = Uint8Array.from(good);
    badTag[0] = 0x31;
    expect(() => parseDerSignature(badTag)).toThrow(/SEQUENCE/);
    expect(() => encodeDerSignature(N, BigInt(1))).not.toThrow();
    expect(() => parseDerSignature(encodeDerSignature(N, BigInt(1)))).toThrow(/out of range/);
  });

  test('stripPublicKeyPrefix accepts both forms and rejects compressed keys', () => {
    expect(stripPublicKeyPrefix(publicKey)).toBe(publicKey.slice(2));
    expect(stripPublicKeyPrefix(publicKey.slice(2))).toBe(publicKey.slice(2));
    expect(() => stripPublicKeyPrefix('02' + 'ab'.repeat(32))).toThrow(/Invalid public key/);
  });
});

describe('vfxSignatureFromDer', () => {
  const message = 'TX_HASH_ABC';
  const expected = keypairService.getSignature(message, privateKey);

  test('reproduces KeypairService.getSignature byte-for-byte from a canonical DER', () => {
    const der = hsmSignDigest(sha256Hex(message));
    expect(vfxSignatureFromDer(der, publicKey)).toBe(expected);
  });

  test('normalises a high-s signature to the canonical low-s form', () => {
    const { r, s } = parseDerSignature(hsmSignDigest(sha256Hex(message)));
    const highS = encodeDerSignature(r, N - s);
    expect(highS).not.toEqual(hsmSignDigest(sha256Hex(message)));
    expect(vfxSignatureFromDer(highS, publicKey)).toBe(expected);
  });

  test('accepts hex and base64 DER strings', () => {
    const der = hsmSignDigest(sha256Hex(message));
    expect(vfxSignatureFromDer(Buffer.from(der).toString('hex'), publicKey)).toBe(expected);
    expect(vfxSignatureFromDer(Buffer.from(der).toString('base64'), publicKey)).toBe(expected);
  });
});

describe('resolveSigner', () => {
  const message = 'TX_HASH_ABC';
  const expected = keypairService.getSignature(message, privateKey);

  test('a local keypair signs exactly as KeypairService does', async () => {
    const resolved = resolveSigner({ privateKey, publicKey, address }, keypairService);
    expect(resolved.address).toBe(address);
    expect(resolved.publicKey).toBe(publicKey.slice(2));
    await expect(resolved.sign(message)).resolves.toBe(expected);
  });

  test('a bare private key is enough', async () => {
    const resolved = resolveSigner({ privateKey }, keypairService);
    expect(resolved.address).toBe(address);
    await expect(resolved.sign(message)).resolves.toBe(expected);
  });

  test('an external signer produces the identical signature string', async () => {
    const resolved = resolveSigner(makeSigner(), keypairService);
    expect(resolved.address).toBe(address);
    expect(resolved.publicKey).toBe(publicKey.slice(2));
    await expect(resolved.sign(message)).resolves.toBe(expected);
  });

  test('an external signer may return a promise, and may omit the 04 prefix', async () => {
    const signer = makeSigner({
      publicKey: publicKey.slice(2),
      signDigest: async (digestHex) => Buffer.from(hsmSignDigest(digestHex)).toString('base64'),
    });
    const resolved = resolveSigner(signer, keypairService);
    await expect(resolved.sign(message)).resolves.toBe(expected);
  });

  test('an external signer that emits high-s signatures is normalised', async () => {
    const signer = makeSigner({ signDigest: (digestHex) => hsmSignDigest(digestHex, { canonical: false }) });
    const resolved = resolveSigner(signer, keypairService);
    // elliptic's non-canonical output is high-s roughly half the time; either
    // way the assembled signature must equal the canonical one.
    await expect(resolved.sign(message)).resolves.toBe(expected);
  });

  test('the signer receives the SHA-256 digest of the message, as hex', async () => {
    const seen: string[] = [];
    const signer = makeSigner({
      signDigest: (digestHex) => {
        seen.push(digestHex);
        return hsmSignDigest(digestHex);
      },
    });
    await resolveSigner(signer, keypairService).sign(message);
    expect(seen).toEqual([sha256Hex(message)]);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  test('rejects a signer whose address does not belong to its key', () => {
    expect(() => resolveSigner(makeSigner({ address: 'xNotMine0000000000000000000000000' }), keypairService)).toThrow(
      /does not match its public key/,
    );
  });

  test('rejects a signer whose address is for the other network', () => {
    const mainnetAddress = new KeypairService(Network.Mainnet).addressFromPrivate(privateKey);
    expect(() => resolveSigner(makeSigner({ address: mainnetAddress }), keypairService)).toThrow(
      /does not match its public key/,
    );
  });

  test('rejects a keypair whose address does not belong to its private key', () => {
    expect(() =>
      resolveSigner({ privateKey, publicKey, address: 'xNotMine0000000000000000000000000' }, keypairService),
    ).toThrow(/does not match its private key/);
  });

  test('rejects input that is neither', () => {
    expect(() => resolveSigner({} as never, keypairService)).toThrow(/privateKey or a Signer/);
    expect(isSigner({ address, publicKey })).toBe(false);
    expect(isSigner(makeSigner())).toBe(true);
  });
});
