import EC from 'elliptic';
import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { nftMintPayload } from '../services/nft-data';
import { nftEvolveRefusal, VfxNft } from '../client/nft-api-client';
import { decryptVfxShh, encryptVfxShh, formatVfxShhMessage, parseVfxShhMessage } from '../services/vfx-shh';
import { verifySignature } from '../services/keypair-service';
import vectors from './test-resources/vfx-shh-vectors.json';
import { installFetch } from './helpers/mock-fetch';

const curve = new EC.ec('secp256k1');
const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const owner = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const SC = '7a6b4c3d-0000-4000-8000-000000000001:1762600000';

function nft(overrides: Partial<VfxNft> = {}, stages: Record<string, unknown>[] | null = null): VfxNft {
  return {
    identifier: SC,
    name: 'Lighthouse',
    description: 'base',
    minter_address: owner.address,
    owner_address: 'xOwner',
    minter_name: 'Mintwood',
    smart_contract_data: JSON.stringify({
      SmartContractMain: {
        Features: stages ? [{ FeatureName: 0, FeatureFeatures: stages }] : [],
      },
    }),
    primary_asset_name: 'art.png',
    primary_asset_size: 10,
    minted_at: '',
    mint_transaction: null,
    burn_transaction: null,
    is_burned: false,
    data: null,
    asset_urls: null,
    is_listed: false,
    ...overrides,
  };
}

const twoStages = [
  { EvolutionState: 1, Name: 'One', Description: 'first', IsCurrentState: false },
  { EvolutionState: 2, Name: 'Two', Description: 'second', IsCurrentState: false },
];

describe('time evolve in the mint payload', () => {
  const base = { name: 'Clock', description: 'd', minterName: 'M', minterAddress: owner.address };
  const evolveFeature = (payload: ReturnType<typeof nftMintPayload>) =>
    (payload.Features as { FeatureName: number; FeatureFeatures: Record<string, unknown>[] }[]).find(
      (f) => f.FeatureName === 0,
    )?.FeatureFeatures as Record<string, unknown>[];

  test("'time' stages carry EvolveDate in UTC ISO, sorted by date, dynamic", () => {
    const payload = nftMintPayload({
      ...base,
      evolve: {
        type: 'time',
        phases: [
          { name: 'Late', description: 'l', evolveDate: '2027-01-02T05:00:00-05:00' },
          { name: 'Early', description: 'e', evolveDate: new Date(Date.UTC(2026, 11, 25, 12, 30)) },
        ],
      },
    });
    const stages = evolveFeature(payload);
    expect(stages.map((s) => [s.Name, s.EvolutionState, s.EvolveDate, s.IsDynamic, s.EvolveBlockHeight])).toEqual([
      ['Early', 1, '2026-12-25T12:30:00.000Z', true, null],
      ['Late', 2, '2027-01-02T10:00:00.000Z', true, null],
    ]);
  });

  test('a time stage without a date, with a zoneless string, or with garbage is refused', () => {
    const phases = (evolveDate?: string) => ({
      ...base,
      evolve: { type: 'time' as const, phases: [{ name: 'A', description: 'a', evolveDate }] },
    });
    expect(() => nftMintPayload(phases())).toThrow(/needs an evolveDate/);
    expect(() => nftMintPayload(phases('2026-12-25T12:30:00'))).toThrow(/no time zone/);
    expect(() => nftMintPayload(phases('soonZ'))).toThrow(/not a valid date/);
    // Calendar days and times that do not exist are refused, not rolled over.
    for (const bad of [
      '2027-02-31T12:00:00Z',
      '2026-02-29T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-12-25T24:00:00Z',
    ]) {
      expect(() => nftMintPayload(phases(bad))).toThrow(/not a valid date/);
    }
    expect(() => nftMintPayload(phases('2028-02-29T23:59:59.5+05:30'))).not.toThrow();
  });

  test("'manual' and 'blockHeight' payloads are unchanged", () => {
    const manual = evolveFeature(
      nftMintPayload({ ...base, evolve: { type: 'manual', phases: [{ name: 'A', description: 'a' }] } }),
    );
    expect(manual[0]).toMatchObject({ IsDynamic: false, EvolveDate: null, EvolveBlockHeight: null });
    const height = evolveFeature(
      nftMintPayload({
        ...base,
        evolve: { type: 'blockHeight', phases: [{ name: 'A', description: 'a', blockHeight: 9 }] },
      }),
    );
    expect(height[0]).toMatchObject({ IsDynamic: true, EvolveDate: null, EvolveBlockHeight: 9 });
  });
});

describe('nftEvolveRefusal (Core ChangeEvolveStateSpecific rules)', () => {
  test('the minter may move an evolving NFT to any stage from 0 to the last', () => {
    for (const stage of [undefined, 0, 1, 2]) {
      expect(nftEvolveRefusal(nft({}, twoStages), owner.address, stage)).toBeNull();
    }
  });

  test('the owner who is not the minter, a vault, a burned NFT and a non-evolving NFT are refused', () => {
    expect(nftEvolveRefusal(nft({}, twoStages), 'xOwner')).toMatch(/Only the minter/);
    expect(nftEvolveRefusal(nft({ minter_address: 'xRBXvault' }, twoStages), 'xRBXvault')).toMatch(/reserve account/);
    expect(nftEvolveRefusal(nft({ is_burned: true }, twoStages), owner.address)).toMatch(/burned/);
    expect(nftEvolveRefusal(nft(), owner.address)).toMatch(/Evolving feature/);
  });

  test('a stage past the last, negative or fractional is refused', () => {
    for (const stage of [3, -1, 1.5]) {
      expect(nftEvolveRefusal(nft({}, twoStages), owner.address, stage)).toMatch(/out of range/);
    }
  });

  test('evolveNft throws the refusal before anything is signed or built', async () => {
    const { calls } = installFetch({ [`/nft/${encodeURIComponent(SC)}/`]: () => nft({}, twoStages) });
    const holderKey = '11'.repeat(32);
    const holder = {
      privateKey: holderKey,
      publicKey: keypairService.publicFromPrivate(holderKey),
      address: keypairService.addressFromPrivate(holderKey),
    };
    await expect(new VfxClient('testnet').evolveNft(holder, { scIdentifier: SC, stage: 1 })).rejects.toThrow(
      /evolveNft: Only the minter/,
    );
    await expect(new VfxClient('testnet').evolveNft(owner, { scIdentifier: SC, stage: 3 })).rejects.toThrow(
      /out of range/,
    );
    expect(calls.filter((c) => c.url.includes('/raw/'))).toHaveLength(0);
  });
});

describe('pullNftBeaconAssets', () => {
  test('signs the contract id as the new owner and asks the node to fetch from the locators', async () => {
    const { calls } = installFetch({
      [`/raw/locators/${encodeURIComponent(SC)}/`]: () => ({ Locators: 'beacon-locator-b64' }),
      '/raw/beacon-assets/': () => ({ success: true }),
    });
    expect(await new VfxClient('testnet').getNftLocators(SC)).toBe('beacon-locator-b64');
    const result = await new VfxClient('testnet').pullNftBeaconAssets(owner, SC);
    expect(result).toEqual({ locators: 'beacon-locator-b64', pulled: true });
    const pull = calls.find((c) => c.url.includes('/raw/beacon-assets/'));
    const parts = new URL(pull?.url as string).pathname.split('/').filter(Boolean);
    const [id, locators, address, signature] = parts.slice(parts.indexOf('beacon-assets') + 1).map(decodeURIComponent);
    expect([id, locators, address]).toEqual([SC, 'beacon-locator-b64', owner.address]);
    expect(verifySignature(SC, signature, owner.address)).toBe(true);
  });

  test('an NFT without media ("NA") has nothing to pull', async () => {
    const { calls } = installFetch({ '/raw/locators/': () => ({ Locators: 'NA' }) });
    expect(await new VfxClient('testnet').pullNftBeaconAssets(owner, SC)).toEqual({ locators: 'NA', pulled: false });
    expect(calls.some((c) => c.url.includes('/raw/beacon-assets/'))).toBe(false);
  });

  test('missing locators, a node refusal and dry run throw', async () => {
    installFetch({ '/raw/locators/': () => ({}) });
    await expect(new VfxClient('testnet').pullNftBeaconAssets(owner, SC)).rejects.toThrow(/no beacon locators/);
    installFetch({ '/raw/locators/': () => ({ Locators: 'L' }), '/raw/beacon-assets/': () => ({ success: false }) });
    await expect(new VfxClient('testnet').pullNftBeaconAssets(owner, SC)).rejects.toThrow(
      /Beacon assets request failed/,
    );
    await expect(new VfxClient('testnet', true).pullNftBeaconAssets(owner, SC)).rejects.toThrow(/dryRun/);
  });
});

describe('VFX-SHH', () => {
  test('decrypts ciphertext made by the reference ECIES library (eciesjs 0.3.18 / eciespy 0.4)', async () => {
    for (const { plaintext, ciphertext } of vectors.vectors) {
      expect(await decryptVfxShh(ciphertext, vectors.privateKey)).toBe(plaintext);
    }
  });

  test('round-trips through encryptVfxShh with a compressed or uncompressed public key', async () => {
    const compressed = curve.keyFromPrivate(privateKey, 'hex').getPublic(true, 'hex');
    expect(await decryptVfxShh(await encryptVfxShh(compressed, 'short'), privateKey)).toBe('short');
    const sealed = await encryptVfxShh(owner.publicKey, 'gm ☀');
    expect(await decryptVfxShh(sealed, privateKey)).toBe('gm ☀');
  });

  test('the wrong key, a truncated or a tampered message throw', async () => {
    const { ciphertext } = vectors.vectors[0];
    await expect(decryptVfxShh(ciphertext, '11'.repeat(32))).rejects.toThrow(/did not decrypt/);
    await expect(decryptVfxShh(ciphertext.slice(0, 40), privateKey)).rejects.toThrow(/too short/);
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[bytes.length - 1] ^= 1;
    await expect(decryptVfxShh(bytes.toString('base64'), privateKey)).rejects.toThrow(/did not decrypt/);
  });

  test('parses the three wallet forms, with real or escaped line breaks and wrapped data', () => {
    const data = vectors.vectors[0].ciphertext;
    const wrapped = `${data.slice(0, 40)}\n  ${data.slice(40)}`;
    for (const text of [
      `Hello\n${formatVfxShhMessage('xAbc', wrapped)}\nbye`,
      `VFX-SHH:xAbc\\n${data}\\n/VFX-SHH`,
      `[VFX-SHH:xAbc]{${data}}[/VFX-SHH]`,
      // Braced and wrapped, then escaped by nftMintPayload's description handling.
      `[VFX-SHH:xAbc]{${data.slice(0, 40)}\\n${data.slice(40)}}[/VFX-SHH]`,
      `[VFX-SHH:xAbc]\n${wrapped}\n[/VFX-SHH]`,
    ]) {
      expect(parseVfxShhMessage(text)).toMatchObject({ recipientAddress: 'xAbc', encryptedData: data });
    }
    expect(parseVfxShhMessage('just a description')).toBeNull();
    expect(parseVfxShhMessage('')).toBeNull();
  });

  test('decryptNftMessage reads the current stage first, then the description, for the recipient only', async () => {
    const sealed = formatVfxShhMessage(owner.address, vectors.vectors[0].ciphertext);
    const client = new VfxClient('testnet');
    const inStage = nft({ description: 'plain' }, [
      { ...twoStages[0], IsCurrentState: true, Description: `stage text ${sealed}` },
      twoStages[1],
    ]);
    expect(await client.decryptNftMessage(owner, inStage)).toEqual({
      recipientAddress: owner.address,
      message: vectors.vectors[0].plaintext,
    });
    // Escaped line breaks, as nftMintPayload writes a description.
    const inDescription = nft({ description: sealed.replace(/\n/g, '\\n') });
    expect((await client.decryptNftMessage(owner, inDescription))?.message).toBe(vectors.vectors[0].plaintext);
    expect(await client.decryptNftMessage(owner, nft())).toBeNull();
    const other = nft({ description: formatVfxShhMessage('xSomeoneElse', vectors.vectors[0].ciphertext) });
    await expect(client.decryptNftMessage(owner, other)).rejects.toThrow(/for xSomeoneElse/);
  });
});
