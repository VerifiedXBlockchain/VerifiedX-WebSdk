/**
 * Loads the built package the way consumers do — the ESM build through
 * Node's own loader (as vitest, Playwright and plain `import` do) and the
 * CJS build through require — and exercises a function from each area. Jest
 * runs the TypeScript sources, so it cannot see a module that only breaks
 * in the ESM build (a CommonJS dependency imported as a namespace, say).
 *
 *   npm run build && npm run test:esm
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const KEY = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const ADDRESS = 'xQJTEE4H9H97SEGTx78esUJR8BkKLYktvB';

async function check(label, sdk) {
  const client = new sdk.VfxClient('testnet');
  const address = client.addressFromPrivate(KEY);
  if (address !== ADDRESS) throw new Error(`${label}: address ${address}, expected ${ADDRESS}`);
  const signature = client.getSignature('smoke', KEY);
  if (!sdk.verifySignature('smoke', signature, ADDRESS)) throw new Error(`${label}: signature does not verify`);
  for (const name of ['decryptVfxShh', 'encryptVfxShh', 'nftMintPayload', 'transactionHash']) {
    if (name in sdk && typeof sdk[name] !== 'function') throw new Error(`${label}: ${name} is not a function`);
  }
  if (sdk.encryptVfxShh) {
    const sealed = await sdk.encryptVfxShh(client.publicFromPrivate(KEY), 'smoke');
    if ((await sdk.decryptVfxShh(sealed, KEY)) !== 'smoke') throw new Error(`${label}: VFX-SHH round trip failed`);
  }
  if (sdk.BtcClient) {
    new sdk.BtcClient('testnet');
  }
  console.log(`${label}: ok`);
}

let failed = false;
for (const [label, load] of [
  ['esm', () => import(path.join(root, 'lib/esm/index.js'))],
  ['cjs', async () => require(path.join(root, 'lib/cjs/index.js'))],
]) {
  try {
    await check(label, await load());
  } catch (error) {
    failed = true;
    console.error(`${label}: FAILED to load or run: ${error instanceof Error ? error.stack : error}`);
  }
}
process.exit(failed ? 1 : 0);
