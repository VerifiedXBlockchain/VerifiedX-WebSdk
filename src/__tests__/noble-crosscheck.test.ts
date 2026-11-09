import EC from 'elliptic';
import { createHash, randomBytes } from 'crypto';
import KeypairService, { verifySignature } from '../services/keypair-service';
import { Network } from '../constants';

/**
 * The SDK signs and derives keys with @noble/curves. elliptic, what it used
 * before, stays as a dev-only oracle: for random keys and messages both must
 * give the same public key and the same signature bytes, and each must
 * accept the other's signatures (elliptic's non-canonical ones, which are
 * high-S about half the time, included).
 */

const curve = new EC.ec('secp256k1');
const service = new KeypairService(Network.Testnet);

function derFromVfxSignature(signature: string): Buffer {
  return Buffer.from(signature.split('.')[0], 'base64');
}

/** A VFX signature (base64 DER . base58 public key) around a DER signature from elliptic. */
function vfxSignatureFromDer(der: number[], vfxSignature: string): string {
  return `${Buffer.from(der).toString('base64')}.${vfxSignature.split('.')[1]}`;
}

describe('@noble matches elliptic', () => {
  test('100 random keys: same public key, same signature bytes, each verifies the other', () => {
    let highS = 0;
    for (let i = 0; i < 100; i++) {
      const key = randomBytes(32).toString('hex');
      const message = `cross-check ${i} ${randomBytes(8).toString('hex')}`;
      const digest = createHash('sha256').update(message, 'utf8').digest();
      const pair = curve.keyFromPrivate(key, 'hex');

      expect(service.publicFromPrivate(key)).toBe(pair.getPublic('hex'));

      const signature = service.getSignature(message, key);
      expect(derFromVfxSignature(signature).toString('hex')).toBe(
        Buffer.from(pair.sign(digest, { canonical: true }).toDER()).toString('hex'),
      );
      expect(pair.verify(digest, [...derFromVfxSignature(signature)])).toBe(true);

      const loose = pair.sign(digest, { canonical: false });
      if (loose.s.cmp(curve.nh) > 0) highS++;
      const address = service.addressFromPrivate(key);
      expect(verifySignature(message, vfxSignatureFromDer(loose.toDER(), signature), address)).toBe(true);
    }
    // The non-canonical half really was exercised.
    expect(highS).toBeGreaterThan(10);
  });
});
