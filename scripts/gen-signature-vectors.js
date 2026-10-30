#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Generates src/__tests__/compat/signature-vectors.json: the verifySignature
 * vectors shared with butterfly-service's verify_vfx_signature, which must
 * return `expected` for every case too. Test keys only: each private key is
 * SHA-256 of a fixed label, so the output is reproducible. Needs the CJS build:
 *
 *   npm run build:cjs && node scripts/gen-signature-vectors.js > src/__tests__/compat/signature-vectors.json
 */
const crypto = require('crypto');
const path = require('path');
const bs58 = require('bs58');
const { KeypairService } = require(path.join(__dirname, '../lib/cjs/services/keypair-service'));
const { parseDerSignature } = require(path.join(__dirname, '../lib/cjs/signer'));
const { Network } = require(path.join(__dirname, '../lib/cjs/constants'));

const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const testnet = new KeypairService(Network.Testnet);
const mainnet = new KeypairService(Network.Mainnet);
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function testKey(label) {
  const privateKey = sha256(label);
  const publicKey = testnet.publicFromPrivate(privateKey);
  return {
    label,
    privateKey,
    publicKey,
    testnet: testnet.addressFromPublic(publicKey),
    mainnet: mainnet.addressFromPublic(publicKey),
    reserve: testnet.reserveAddressFromPublic(publicKey),
  };
}

function firstKeyWithZeroLedX() {
  for (let i = 0; ; i++) {
    const key = testKey(`vfx-web-sdk verifySignature vector key: zero-x ${i}`);
    if (key.publicKey.slice(2, 4) === '00') {
      return key;
    }
  }
}

const alice = testKey('vfx-web-sdk verifySignature vector key: alice');
const bob = testKey('vfx-web-sdk verifySignature vector key: bob');
const zeroX = firstKeyWithZeroLedX();

const chatPublicKey = sha256('vfx-web-sdk verifySignature vector: chat key');
const statement = (network, address) => `vfx-chat-key:v1:${network}:${address}:${chatPublicKey}`;

const parts = (signature) => {
  const dot = signature.indexOf('.');
  return [signature.slice(0, dot), signature.slice(dot + 1)];
};
const derOf = (signature) => Buffer.from(parts(signature)[0], 'base64');
const withDer = (signature, der) => `${Buffer.from(der).toString('base64')}.${parts(signature)[1]}`;
const withPublicKey = (signature, bytes) => `${parts(signature)[0]}.${bs58.encode(Buffer.from(bytes))}`;
const xy = (key) => Buffer.from(key.publicKey.slice(2), 'hex');
const byte = (b) => Buffer.from([b]);

function derInteger(value) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');
  return bytes[0] & 0x80 ? Buffer.concat([byte(0), bytes]) : bytes;
}
function derSequence(rBytes, sBytes) {
  const body = Buffer.concat([byte(0x02), byte(rBytes.length), rBytes, byte(0x02), byte(sBytes.length), sBytes]);
  return Buffer.concat([byte(0x30), byte(body.length), body]);
}

const vectors = [];
const add = (name, message, signature, address, expected, note) =>
  vectors.push({ name, message, signature, address, expected, ...(note ? { note } : {}) });

const tMessage = statement('testnet', alice.testnet);
const tSig = testnet.getSignature(tMessage, alice.privateKey);
const mMessage = statement('mainnet', alice.mainnet);
const mSig = mainnet.getSignature(mMessage, alice.privateKey);
const [tB64, tPub] = parts(tSig);

// Round trips and wrong inputs
add('testnet chat-key statement', tMessage, tSig, alice.testnet, true);
add('mainnet chat-key statement', mMessage, mSig, alice.mainnet, true);
add(
  'same key, other network address',
  mMessage,
  mSig,
  alice.testnet,
  true,
  'The network is read from the address (x = testnet, otherwise mainnet); the statement is what binds the network.',
);
add('empty message', '', testnet.getSignature('', alice.privateKey), alice.testnet, true);
const unicode = 'héllo 🌍 — ünïcode';
add('non-ASCII message (UTF-8 hashed)', unicode, testnet.getSignature(unicode, alice.privateKey), alice.testnet, true);
add('wrong message (one character changed)', tMessage.replace(':testnet:', ':testnex:'), tSig, alice.testnet, false);
add('wrong message (trailing newline)', tMessage + '\n', tSig, alice.testnet, false);
add('wrong address (another key)', tMessage, tSig, bob.testnet, false);
add('wrong address (another key, mainnet)', tMessage, tSig, bob.mainnet, false);
add("signer's reserve (xRBX) address", tMessage, tSig, alice.reserve, false);
add('empty address', tMessage, tSig, '', false);
add('address with trailing space', tMessage, tSig, alice.testnet + ' ', false);
add(
  "another key's signature with the signer's public key swapped in",
  tMessage,
  withPublicKey(testnet.getSignature(tMessage, bob.privateKey), xy(alice)),
  alice.testnet,
  false,
);

// Malformed signature strings
add('empty signature', tMessage, '', alice.testnet, false);
add('no dot', tMessage, tB64, alice.testnet, false);
add('empty public key part', tMessage, tB64 + '.', alice.testnet, false);
add('empty signature part', tMessage, '.' + tPub, alice.testnet, false);
add('second dot', tMessage, tSig + '.x', alice.testnet, false);
add('public key part has a non-base58 character', tMessage, tSig.slice(0, -1) + '0', alice.testnet, false);
add('leading whitespace before the public key', tMessage, `${tB64}. ${tPub}`, alice.testnet, false);
add('public key truncated to 62 bytes', tMessage, withPublicKey(tSig, xy(alice).subarray(0, 62)), alice.testnet, false);
const offCurve = Buffer.from(xy(alice));
offCurve[63] ^= 1;
add('public key not on the curve', tMessage, withPublicKey(tSig, offCurve), alice.testnet, false);
add(
  'base64 missing its padding',
  tMessage,
  `${tB64.replace(/=+$/, '')}.${tPub}`,
  alice.testnet,
  false,
  'Python b64decode requires padding; the SDK signer always pads.',
);
add('base64 is not a DER signature', tMessage, `aGVsbG8=.${tPub}`, alice.testnet, false);
add('DER with a trailing byte', tMessage, withDer(tSig, Buffer.concat([derOf(tSig), byte(0)])), alice.testnet, false);
const { r, s } = parseDerSignature(derOf(tSig));
const rDer = derInteger(r);
const sDer = derInteger(s);
add(
  'DER integer with an unnecessary leading zero',
  tMessage,
  withDer(tSig, derSequence(Buffer.concat([byte(0), rDer]), sDer)),
  alice.testnet,
  false,
);
add(
  'DER integer encoded as negative',
  tMessage,
  withDer(tSig, derSequence(Buffer.concat([byte(0x80), rDer]), sDer)),
  alice.testnet,
  false,
);
add('r = 0', tMessage, withDer(tSig, derSequence(byte(0), sDer)), alice.testnet, false);
add('s = n', tMessage, withDer(tSig, derSequence(rDer, derInteger(N))), alice.testnet, false);
add('r and s swapped', tMessage, withDer(tSig, derSequence(sDer, rDer)), alice.testnet, false);
add(
  'high-s form of a valid signature (s replaced by n - s)',
  tMessage,
  withDer(tSig, derSequence(rDer, derInteger(N - s))),
  alice.testnet,
  true,
  'Both verifiers accept high-s; the SDK signer only emits low-s.',
);

// Encodings the platform accepts that the SDK signer never produces
add(
  'base64 with a line break inside',
  tMessage,
  `${tB64.slice(0, 20)}\n${tB64.slice(20)}.${tPub}`,
  alice.testnet,
  true,
  'Python b64decode skips characters outside the alphabet.',
);
add(
  'base64 with junk after the padding',
  tMessage,
  `${tB64}AAAA.${tPub}`,
  alice.testnet,
  true,
  'Python b64decode stops at the first complete pad sequence (the base64 here ends in padding).',
);
add(
  'trailing whitespace after the public key',
  tMessage,
  tSig + ' \n',
  alice.testnet,
  true,
  'Python base58 strips trailing whitespace.',
);
const odd = xy(alice)[63] & 1;
const x = xy(alice).subarray(0, 32);
add(
  'public key with 04 prefix (65 bytes)',
  tMessage,
  withPublicKey(tSig, Buffer.concat([byte(4), xy(alice)])),
  alice.testnet,
  true,
);
add(
  'compressed public key (33 bytes)',
  tMessage,
  withPublicKey(tSig, Buffer.concat([byte(odd ? 3 : 2), x])),
  alice.testnet,
  true,
  'The address is still derived from the uncompressed key.',
);
add(
  'compressed public key with the wrong parity',
  tMessage,
  withPublicKey(tSig, Buffer.concat([byte(odd ? 2 : 3), x])),
  alice.testnet,
  false,
);
add(
  'hybrid public key (06/07), consistent parity',
  tMessage,
  withPublicKey(tSig, Buffer.concat([byte(odd ? 7 : 6), xy(alice)])),
  alice.testnet,
  true,
);
add(
  'hybrid public key (06/07), wrong parity',
  tMessage,
  withPublicKey(tSig, Buffer.concat([byte(odd ? 6 : 7), xy(alice)])),
  alice.testnet,
  false,
);
add(
  '65-byte public key with an unknown prefix',
  tMessage,
  withPublicKey(tSig, Buffer.concat([byte(5), xy(alice)])),
  alice.testnet,
  false,
);

// The padding case: a public key whose x coordinate starts with a zero byte
const zMessage = statement('testnet', zeroX.testnet);
const zSig = testnet.getSignature(zMessage, zeroX.privateKey);
const zDropped = xy(zeroX).subarray(1);
add('zero-led public key as the SDK encodes it (64 bytes; base58 starts with 1)', zMessage, zSig, zeroX.testnet, true);
add(
  'zero-led public key with the zero byte dropped (63 bytes)',
  zMessage,
  withPublicKey(zSig, zDropped),
  zeroX.testnet,
  true,
  'butterfly-service pads a 63-byte key with 00 before decoding it.',
);
add(
  'zero-led public key, 63 bytes, wrong message',
  zMessage + 'x',
  withPublicKey(zSig, zDropped),
  zeroX.testnet,
  false,
);
const zmMessage = statement('mainnet', zeroX.mainnet);
add(
  'zero-led public key, 63 bytes, mainnet',
  zmMessage,
  withPublicKey(mainnet.getSignature(zmMessage, zeroX.privateKey), zDropped),
  zeroX.mainnet,
  true,
);

const output = {
  description:
    'Shared vectors for VFX signature verification. vfx-web-sdk verifySignature(message, signature, address) and butterfly-service verify_vfx_signature(address, message, signature) must both return `expected` for every case. Test keys only: each private key is SHA-256 of its label. Generated by vfx-web-sdk scripts/gen-signature-vectors.js.',
  signatureFormat:
    'base64(DER ECDSA secp256k1 signature over SHA-256 of the UTF-8 message) + "." + base58(64-byte public key x||y)',
  keys: [alice, bob, zeroX],
  vectors,
};
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
