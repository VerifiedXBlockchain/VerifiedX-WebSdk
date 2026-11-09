/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Regenerates src/__tests__/compat/btc-seed-vectors.json from the Flutter web
 * wallet itself: loads its compiled keygen bundle (vfx-gui
 * assets/js/keygen-v3.js) and replays auth_utils.dart
 * handleImportWithBtcPrivateKey (seed = first 16 + last 16 characters of the
 * key text as typed, then KeygenService.seedToKeypair = window.seedToPrivate
 * + window.importPrivateKey). Uses no SDK code.
 *
 *   node scripts/wallet-compat/gen-btc-seed-vectors.js [path-to-vfx-gui]
 *
 * The vfx-gui checkout defaults to ../vfx-gui (or VFX_GUI_PATH); its HEAD
 * commit is recorded in the output so the run can be repeated.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const guiPath = path.resolve(
  process.argv[2] || process.env.VFX_GUI_PATH || path.resolve(__dirname, '../../../vfx-gui'),
);
const bundle = path.join(guiPath, 'assets/js/keygen-v3.js');
if (!fs.existsSync(bundle)) {
  console.error(`wallet keygen bundle not found at ${bundle}; pass the vfx-gui checkout path`);
  process.exit(2);
}
const walletCommit = execFileSync('git', ['-C', guiPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

global.window = global;
require(bundle);

// The same key (and a second one) as hex, upper-case hex and WIF: the wallet
// seeds from the text, so each form is its own account.
const inputs = [
  { name: 'hexLower', btcKey: '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5' },
  { name: 'hexUpper', btcKey: '47412619788FECB0EA0B152D1398E5EC742223D14DD8F46121B80CC0B1260BA5' },
  { name: 'hexLeadingZeros', btcKey: '0000000000000000000000000000000000000000000000000000000000000001' },
  // WIFs (compressed) of the hexLower key on testnet and mainnet, and of 0e5f3a1c…3e2f on testnet.
  { name: 'wifTestnet', btcKey: 'cPyDCEfZ849CfGmme8zXF5QmTFauaB5sgcXE3BgX7dCcedAqn6z5' },
  { name: 'wifMainnet', btcKey: 'KycDjKfhgzSwVqJWFjBPskuhq2HVuizBcaNkvmE1cWYcPt9exDr5' },
  { name: 'wifTestnet2', btcKey: 'cN4e1VEEAonQi5wvswrhJwNgQ8k99Qd2tR3gwKQvTUE6G75y3Ddx' },
];

const vectors = inputs.map((input) => {
  const seed = input.btcKey.substring(0, 16) + input.btcKey.substring(input.btcKey.length - 16);
  const privateKey = window.seedToPrivate(seed);
  const [testnetAddress, publicKey] = window.importPrivateKey(privateKey, true).split(':');
  const [mainnetAddress] = window.importPrivateKey(privateKey, false).split(':');
  return { ...input, seed, privateKey, publicKey, testnetAddress, mainnetAddress };
});

const out = {
  source:
    'vfx-gui assets/js/keygen-v3.js (seedToPrivate, importPrivateKey), auth_utils.dart handleImportWithBtcPrivateKey',
  walletCommit,
  generator: 'scripts/wallet-compat/gen-btc-seed-vectors.js',
  vectors,
};
const target = path.resolve(__dirname, '../../src/__tests__/compat/btc-seed-vectors.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${vectors.length} vectors from vfx-gui ${walletCommit.slice(0, 8)} to ${target}`);
