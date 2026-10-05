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
  process.argv[2] || process.env.WALLET_KEYGEN_PATH || path.resolve(__dirname, '../../vfx-gui/assets/js/keygen-v3.js');

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
  check(
    `email ${v.email} idx${v.index}`,
    svcTest.privateKeyFromEmailPassword(v.email, v.password, v.index),
    '00' + walletKey,
  );
}

// 4. Reserve (vault) accounts: replay the wallet's auth_utils.dart loop
// against the bundle and compare with the SDK, on the pinned vectors and on
// fresh random main keys.
const reserveVectors = require('../src/__tests__/compat/reserve-vectors.json');
function walletVaultFromMain(mainPrivate, isTestNet) {
  let input = mainPrivate.startsWith('00') ? mainPrivate.slice(2) : mainPrivate;
  for (let append = 0; append < 1000; append++) {
    const raPriv = window.importPrivateKey(window.seedToPrivate(input.slice(0, 32) + append), isTestNet).split(':')[2];
    const [ra, rec, code] = window.generateReserveAccountRestoreCode(raPriv, isTestNet).split('|');
    if (ra.startsWith('xRBX')) {
      return {
        address: ra.split(':')[0],
        privateKey: ra.split(':')[2],
        recoveryAddress: rec.split(':')[0],
        restoreCode: code,
      };
    }
  }
  throw new Error('wallet loop did not find an xRBX address');
}
function checkVault(label, sdkVault, walletVault) {
  check(`${label} address`, sdkVault.address, walletVault.address);
  check(`${label} privateKey`, sdkVault.privateKey, '00' + walletVault.privateKey);
  check(`${label} recoveryAddress`, sdkVault.recoveryAddress, walletVault.recoveryAddress);
  check(`${label} restoreCode`, sdkVault.restoreCode, walletVault.restoreCode);
}
for (const [name, v] of Object.entries(reserveVectors)) {
  if (!v.mainPrivateKey) continue;
  checkVault(
    `reserve ${name} test`,
    svcTest.reserveKeypairFromPrivateKey(v.mainPrivateKey),
    walletVaultFromMain(v.mainPrivateKey, true),
  );
  checkVault(
    `reserve ${name} main`,
    svcMain.reserveKeypairFromPrivateKey(v.mainPrivateKey),
    walletVaultFromMain(v.mainPrivateKey, false),
  );
}
for (let i = 0; i < 50; i++) {
  const pk = crypto.randomBytes(32).toString('hex');
  checkVault(`reserve fuzz${i} test`, svcTest.reserveKeypairFromPrivateKey(pk), walletVaultFromMain(pk, true));
  // Direct reserve-key path (restore-from-key), both networks for the recovery address.
  const direct = window.generateReserveAccountRestoreCode(pk, false).split('|');
  if (direct[0].startsWith('xRBX')) {
    const sdk = svcMain.reserveKeypairFromReservePrivateKey(pk);
    check(`reserve fuzz${i} direct address`, sdk.address, direct[0].split(':')[0]);
    check(`reserve fuzz${i} direct recovery`, sdk.recoveryAddress, direct[1].split(':')[0]);
    check(`reserve fuzz${i} direct code`, sdk.restoreCode, direct[2]);
  }
}

console.log(`\nwallet-compat: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
