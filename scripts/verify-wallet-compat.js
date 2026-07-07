/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Live wallet-compat verification.
 *
 * Loads the VFX web wallet's compiled keygen bundle (vfx-gui keygen-v3.js)
 * and asserts that the built SDK derives identical addresses/keys for every
 * golden vector plus a fresh random fuzz set. Run this whenever keypair code
 * changes, before publishing:
 *
 *   npm run build && node scripts/verify-wallet-compat.js [path-to-keygen-v3.js]
 *
 * The path can also be set via WALLET_KEYGEN_PATH. Exits non-zero on any
 * mismatch. The jest suite (src/__tests__/compat) covers the same vectors
 * without needing the wallet bundle; this script is the source-of-truth
 * cross-check against the wallet itself.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const walletPath =
  process.argv[2] ||
  process.env.WALLET_KEYGEN_PATH ||
  path.resolve(__dirname, '../../vfx-gui/assets/js/keygen-v3.js');

if (!fs.existsSync(walletPath)) {
  console.error(`wallet keygen bundle not found at ${walletPath}`);
  console.error('pass the path as an argument or set WALLET_KEYGEN_PATH');
  process.exit(2);
}

global.window = global;
require(walletPath);

const { default: KeypairService } = require('../lib/cjs/services/keypair-service');
const vectors = require('../src/__tests__/compat/golden-vectors.json');

const svcMain = new KeypairService('mainnet');
const svcTest = new KeypairService('testnet');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL ${label}\n  actual:   ${actual}\n  expected: ${expected}`);
  }
}

// 1. Golden vectors against BOTH wallet and SDK
for (const v of vectors.privateKeys) {
  check(`wallet main ${v.privateKey.slice(0, 8)}`, window.addressFromPrivateKey(v.privateKey, false), v.mainnetAddress);
  check(`wallet test ${v.privateKey.slice(0, 8)}`, window.addressFromPrivateKey(v.privateKey, true), v.testnetAddress);
  check(`sdk main ${v.privateKey.slice(0, 8)}`, svcMain.addressFromPrivate(v.privateKey), v.mainnetAddress);
  check(`sdk test ${v.privateKey.slice(0, 8)}`, svcTest.addressFromPrivate(v.privateKey), v.testnetAddress);
}

// 2. Fresh random fuzz: wallet vs SDK directly
for (let i = 0; i < 100; i++) {
  const pk = crypto.randomBytes(32).toString('hex');
  check(`fuzz${i} main`, svcMain.addressFromPrivate(pk), window.addressFromPrivateKey(pk, false));
  check(`fuzz${i} test`, svcTest.addressFromPrivate(pk), window.addressFromPrivateKey(pk, true));
  check(`fuzz${i} pub`, svcMain.publicFromPrivate(pk), window.publicKeyFromPrivateKey(pk));
}

// 3. Email seed path: SDK vs wallet seedToPrivate
const CryptoJS = require('crypto-js');
function sdkSeedPrep(email, password) {
  email = email.toLowerCase();
  let seed = `${email}|${password}|`;
  seed = `${seed}${seed.length}|!@${(password.length * 7 + email.length) * 7}`;
  seed = `${seed}${3 * password.length}3571`;
  seed = `${seed}${seed}`;
  for (let i = 0; i <= 50; i++) seed = CryptoJS.SHA256(seed).toString(CryptoJS.enc.Hex);
  return seed;
}
for (const v of vectors.email) {
  const seed = sdkSeedPrep(v.email, v.password);
  const walletKey = window.seedToPrivate(seed, v.index);
  check(`email ${v.email} idx${v.index}`, svcTest.privateKeyFromEmailPassword(v.email, v.password, v.index), '00' + walletKey);
}

console.log(`\nwallet-compat: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
