#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Generates src/__tests__/compat/wallet-flow-vectors.json from the Flutter
 * web wallet itself, never from this SDK.
 *
 * The wallet's sign-in flows are split between Dart and two compiled JS
 * bundles, so both halves run here:
 *
 *   Dart (dart/bin/main.dart, run with the wallet's pinned Flutter SDK):
 *     - the email/password seed, copied verbatim from auth_utils.dart
 *       handleCreateWithEmail
 *     - recovery phrase -> private key (bip39 1.0.6 + bip32 2.0.0, the
 *       wallet's pinned packages) after normalizeRecoveryPhrase
 *     - imported-key text handling (private_key_text.dart, copied unmodified
 *       into dart/lib at run time): canonical key, derivation text
 *       candidates, Bitcoin email/password, `privateCorrected`
 *   JS (vfx-gui/assets/js):
 *     - keygen-v3.js: seedToPrivate, importPrivateKey, the reserve loop
 *     - btc.js: btcKeypairFromEmailPassword (KeypairService)
 *
 * Every input is deterministic (SHA-256 of a label), so a rerun yields the
 * same file. Usage:
 *
 *   node scripts/wallet-compat/gen-wallet-flow-vectors.js [path-to-vfx-gui] \
 *     > src/__tests__/compat/wallet-flow-vectors.json
 *
 * Env: DART (default ~/fvm/versions/3.7.12/bin/dart, the wallet's Flutter
 * pin), GUI_REF (default origin/testnet).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const bip39 = require('bip39');

const guiPath = path.resolve(process.argv[2] || process.env.VFX_GUI_PATH || path.join(__dirname, '../../../vfx-gui'));
const guiRef = process.env.GUI_REF || 'origin/testnet';
const dart = process.env.DART || path.join(os.homedir(), 'fvm/versions/3.7.12/bin/dart');
const dartDir = path.join(__dirname, 'dart');

const git = (...args) => execFileSync('git', ['-C', guiPath, ...args], { encoding: 'utf8' });
const guiCommit = git('rev-parse', '--short', guiRef).trim();

// The Dart half reads the wallet's own utility files, unmodified.
fs.mkdirSync(path.join(dartDir, 'lib'), { recursive: true });
for (const file of ['private_key_text.dart', 'recovery_phrase.dart']) {
  fs.writeFileSync(path.join(dartDir, 'lib', file), git('show', `${guiRef}:lib/features/keygen/utils/${file}`));
}
// main.dart carries a verbatim copy of the email seed; refuse to run if the
// wallet's copy has changed since.
const authUtils = git('show', `${guiRef}:lib/features/auth/auth_utils.dart`);
const mainDart = fs.readFileSync(path.join(dartDir, 'bin/main.dart'), 'utf8');
const seedBlock = (text) =>
  text
    .slice(text.indexOf('String email = emailValue.toLowerCase();'), text.indexOf('for (int i = 0; i <= 50; i++)'))
    .trim();
if (seedBlock(authUtils) !== seedBlock(mainDart)) {
  throw new Error('auth_utils.dart email seed changed; update dart/bin/main.dart from the wallet first');
}

global.window = global;
require(path.join(guiPath, 'assets/js/keygen-v3.js'));
require(path.join(guiPath, 'assets/js/btc.js'));
/* global btc */
const btcServices = { testnet: new btc.KeypairService(true), mainnet: new btc.KeypairService(false) };
const isTestNet = { testnet: true, mainnet: false };

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const pick = (label, list) => list[parseInt(sha256(label).slice(0, 8), 16) % list.length];

// ---- inputs --------------------------------------------------------------

const PASSWORD_ALPHABETS = [
  'abcdefghijklmnopqrstuvwxyz',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{};:,.<>/?|~ ',
  'áéíóúñüçßøåæ€£¥漢字かなカナ한글🙂',
];
function generatedText(label, alphabet, length) {
  const chars = Array.from(alphabet);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[parseInt(sha256(`${label}:${i}`).slice(0, 8), 16) % chars.length];
  }
  return out;
}

const emailCases = [
  { email: 'test@verifiedx.io', password: 'test1234' },
  { email: 'Test.User@VerifiedX.io', password: 'Password1!' },
  { email: '  spaced@example.com  ', password: ' pass with spaces ' },
  { email: 'pipe|user@example.com', password: 'a|b|c' },
  { email: 'üñíçødé@exämple.com', password: 'contraseña-ñ' },
  { email: 'emoji@example.com', password: '🙂🙂🙂' },
  { email: 'short@x.io', password: 'a' },
  { email: 'long@example.com', password: 'x'.repeat(200) },
  { email: 'runs@example.com', password: 'abc123DEF456ghi' },
  // The wallet's character-class regexes are written as JS literals inside a
  // Dart RegExp ('/[a-z]+/g'), so they only match those literal slashes. A
  // password with two or more such runs changes the seed in the wallet.
  { email: 'slashes@example.com', password: '/abc/g' },
  { email: 'slashes2@example.com', password: '/abc/g/def/g' },
  { email: 'slashes3@example.com', password: 'x/ab/gy/CD/gz/12/g' },
];
for (let i = 0; i < 30; i++) {
  const alphabet = pick(`email-alpha:${i}`, PASSWORD_ALPHABETS);
  const length = 1 + (parseInt(sha256(`email-len:${i}`).slice(0, 4), 16) % 40);
  emailCases.push({
    email: `${generatedText(`email-user:${i}`, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._+', 4 + (i % 12))}@example${i % 5}.com`,
    password: generatedText(`email-pass:${i}`, alphabet, length),
  });
}

const mnemonicCases = [];
for (let i = 0; i < 30; i++) {
  const words = i % 2 === 0 ? 12 : 24;
  const entropy = sha256(`mnemonic:${i}`).slice(0, words === 12 ? 32 : 64);
  const phrase = bip39.entropyToMnemonic(entropy);
  mnemonicCases.push({ phrase, index: 0, words });
  if (i < 10) mnemonicCases.push({ phrase, index: 1 + (i % 4), words });
}
// Typed and pasted forms the wallet normalises before checking.
const base12 = bip39.entropyToMnemonic(sha256('mnemonic-messy:12').slice(0, 32));
const base24 = bip39.entropyToMnemonic(sha256('mnemonic-messy:24').slice(0, 64));
const fullWidth = (text) => Array.from(text, (c) => (/[a-z]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');
for (const [base, words] of [
  [base12, 12],
  [base24, 24],
]) {
  mnemonicCases.push(
    { phrase: base[0].toUpperCase() + base.slice(1), index: 0, words },
    { phrase: `  ${base.split(' ').join('   ')}\n`, index: 0, words },
    { phrase: base.split(' ').join('\n'), index: 0, words },
    { phrase: base.toUpperCase(), index: 0, words },
    { phrase: base.split(' ').join('　'), index: 0, words },
    { phrase: fullWidth(base), index: 0, words },
    { phrase: base.split(' ').join(' '), index: 0, words },
  );
}

const keyTextCases = [];
for (let i = 0; i < 16; i++) {
  const canonical = sha256(`imported-key:${i}`);
  keyTextCases.push({ entered: canonical });
}
const forcedTop = (label, prefix) => prefix + sha256(label).slice(prefix.length);
for (const [i, prefix] of ['8', 'f', 'a', '0', '00', '000', '0000'].entries()) {
  const key = forcedTop(`imported-prefix:${i}`, prefix);
  keyTextCases.push({ entered: key });
  keyTextCases.push({ entered: '00' + key });
  keyTextCases.push({ entered: key.replace(/^0+/, '') });
  if (parseInt(key[0], 16) >= 8) keyTextCases.push({ entered: '0' + key });
  keyTextCases.push({ entered: `0x${key.toUpperCase()}` });
  keyTextCases.push({ entered: ` ${key.slice(0, 20)} ${key.slice(20)}\n` });
}

// ---- Dart half -----------------------------------------------------------

function runDart(input) {
  const inputPath = path.join(os.tmpdir(), `wallet-compat-${process.pid}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(input));
  try {
    execFileSync(dart, ['pub', 'get', '--offline'], { cwd: dartDir, stdio: 'ignore' });
    return JSON.parse(execFileSync(dart, ['run', 'bin/main.dart', inputPath], { cwd: dartDir, encoding: 'utf8' }));
  } finally {
    fs.unlinkSync(inputPath);
  }
}

const phase1 = runDart({ email: emailCases, mnemonic: mnemonicCases, keyText: keyTextCases, privateCorrected: [] });

// ---- JS half -------------------------------------------------------------

function importPrivateKey(privateKey, network) {
  const [address, publicKey, privateOut] = window.importPrivateKey(privateKey, isTestNet[network]).split(':');
  return { address, publicKey, private: privateOut };
}

// auth_utils.dart / imported_key_accounts.dart: count up until the reserve
// account of seedToPrivate(text[0:32] + attempt) has an xRBX address.
function walletReserve(reserveSeedFor, network) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const keypair = importPrivateKey(window.seedToPrivate(reserveSeedFor(attempt)), network);
    const [primary, recovery, restoreCode] = window
      .generateReserveAccountRestoreCode(keypair.private, isTestNet[network])
      .split('|');
    const [address, publicKey, privateKey] = primary.split(':');
    if (address.startsWith('xRBX')) {
      const [recoveryAddress, recoveryPublicKey, recoveryPrivateKey] = recovery.split(':');
      return { attempt, address, publicKey, privateKey, recoveryAddress, recoveryPublicKey, recoveryPrivateKey, restoreCode };
    }
  }
  throw new Error('reserve loop did not find an xRBX address');
}

function walletBtc(email, password, network) {
  const account = btcServices[network].keypairFromEmailPassword(email, password);
  return { address: account.address, wif: account.wif, privateKey: account.privateKey, publicKey: account.publicKey };
}

// The wallet's private key text for every email and phrase login, so the
// Dart half can turn it into the Bitcoin derivation text (privateCorrected).
const emailPrivates = phase1.email.map((c) => window.seedToPrivate(c.seed));
const mnemonicPrivates = phase1.mnemonic.map((c) => (c.privateKey ? importPrivateKey(c.privateKey, 'testnet').private : null));
const phase2 = runDart({
  email: [],
  mnemonic: [],
  keyText: [],
  privateCorrected: [...emailPrivates, ...mnemonicPrivates.filter((p) => p !== null)],
});
const correctedByPrivate = new Map(phase2.privateCorrected.map((c) => [c.private, c]));

// For a login whose main key text is `privateText`: the account, its vault
// and its Bitcoin account on both networks, as the wallet derives them.
function accountsFromPrivate(privateText) {
  const corrected = correctedByPrivate.get(privateText);
  const out = { derivationText: corrected.derivationText, btcEmail: corrected.btcEmail, btcPassword: corrected.btcPassword };
  let reserveInput = privateText;
  if (reserveInput.startsWith('00')) reserveInput = reserveInput.substring(2);
  for (const network of ['testnet', 'mainnet']) {
    out[network] = {
      address: importPrivateKey(privateText, network).address,
      reserve: walletReserve((attempt) => `${reserveInput.substring(0, 32)}${attempt}`, network),
      btc: walletBtc(corrected.btcEmail, corrected.btcPassword, network),
    };
  }
  return out;
}

const email = phase1.email.map((c, i) => ({
  email: c.email,
  password: c.password,
  seed: c.seed,
  privateKey: emailPrivates[i],
  ...accountsFromPrivate(emailPrivates[i]),
}));

const mnemonic = phase1.mnemonic.map((c, i) => ({
  phrase: c.phrase,
  words: mnemonicCases[i].words,
  index: c.index,
  normalized: c.normalized,
  privateKey: mnemonicPrivates[i],
  ...(mnemonicPrivates[i] ? accountsFromPrivate(mnemonicPrivates[i]) : {}),
}));

const importedKeys = phase1.keyText.map((c) => ({
  entered: c.entered,
  canonical: c.canonical,
  testnetAddress: c.canonical ? importPrivateKey(c.canonical, 'testnet').address : null,
  mainnetAddress: c.canonical ? importPrivateKey(c.canonical, 'mainnet').address : null,
  candidates: c.candidates.map((candidate) => {
    const out = { ...candidate };
    for (const network of ['testnet', 'mainnet']) {
      out[network] = {
        reserve: walletReserve((attempt) => `${candidate.derivationText.substring(0, 32)}${attempt}`, network),
        btc: walletBtc(candidate.btcEmail, candidate.btcPassword, network),
      };
    }
    return out;
  }),
}));

process.stdout.write(
  JSON.stringify(
    {
      source: `vfx-gui ${guiRef} ${guiCommit}: auth_utils.dart, keygen_service.dart, private_key_text.dart, recovery_phrase.dart (Dart, Flutter 3.7.12) + assets/js/keygen-v3.js + assets/js/btc.js`,
      email,
      mnemonic,
      importedKeys,
    },
    null,
    1,
  ) + '\n',
);
