import crypto from 'crypto';
import KeypairService from '../btc/keypair';

/**
 * BTC message signatures must be strict canonical DER. The previous
 * hand-rolled encoding emitted invalid DER for ~50% of signatures (r with
 * the high bit set) — the node's lax parser happened to accept them, but
 * nothing else would.
 */

function strictDerParse(der: Buffer): { r: Buffer; s: Buffer } | null {
  let i = 0;
  if (der[i++] !== 0x30) return null;
  const totalLen = der[i++];
  if (totalLen !== der.length - 2) return null;
  const readInt = (): Buffer | null => {
    if (der[i++] !== 0x02) return null;
    const len = der[i++];
    if (len === 0) return null;
    const bytes = der.subarray(i, i + len);
    if (bytes.length !== len) return null;
    if (bytes[0] & 0x80) return null; // negative => invalid
    if (len > 1 && bytes[0] === 0x00 && !(bytes[1] & 0x80)) return null; // non-minimal
    i += len;
    return Buffer.from(bytes);
  };
  const r = readInt();
  if (!r) return null;
  const s = readInt();
  if (!s) return null;
  if (i !== der.length) return null;
  return { r, s };
}

const service = new KeypairService(true);

describe('BTC message signatures are strict canonical DER', () => {
  test('200 random signatures all strict-parse (covers high-bit and short r/s)', () => {
    let highBitR = 0;
    for (let i = 0; i < 200; i++) {
      const privateKey = crypto.randomBytes(32).toString('hex');
      const signature = service.signMessageWithPrivateKey(privateKey, `msg-${i}`);
      const der = Buffer.from(signature.split('.')[0], 'hex');
      const parsed = strictDerParse(der);
      expect(parsed).not.toBeNull();
      if (der[4] === 0x00) highBitR++;
    }
    // Sanity: the sample actually exercised the padded-r case.
    expect(highBitR).toBeGreaterThan(50);
  });

  test('signature format stays derhex.pubkeyhex', () => {
    const privateKey = crypto.randomBytes(32).toString('hex');
    const signature = service.signMessageWithPrivateKey(privateKey, 'format-check');
    const [derHex, pubHex] = signature.split('.');
    expect(derHex).toMatch(/^30/);
    expect(pubHex).toMatch(/^(02|03)[0-9a-f]{64}$/);
  });
});
