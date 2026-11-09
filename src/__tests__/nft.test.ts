import EC from 'elliptic';
import { VfxClient, NftBulkMintError } from '../index';
import KeypairService from '../services/keypair-service';
import { Network, TxType } from '../constants';
import { nftMintPayload } from '../services/nft-data';
import { nftContract, nftCurrentStage, nftEvolveStages, nftIsMedialess } from '../client/nft-api-client';
import { Signer, SigningIntent, SigningRequest } from '../signer';
import { transactionHash, HashableTransaction } from '../services/transaction-hash';
import { CapturedCall, installFetch, textResponse } from './helpers/mock-fetch';

const curve = new EC.ec('secp256k1');
const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const owner = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const vault = keypairService.vaultKeypairFromPrivateKey(keypairService.newVaultKeypair().privateKey);
const RECIPIENT = 'xRecipient00000000000000000000000';
const SC = '7a6b4c3d-0000-4000-8000-000000000001:1762600000';

const nodeHash = (_url: string, init?: RequestInit) => ({
  Result: 'Success',
  Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
});

function installPipeline(overrides: Record<string, (url: string, init?: RequestInit) => unknown> = {}) {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/hash/': nodeHash,
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
    '/raw/smart-contract-data/': () => [{ Function: 'Mint()', ContractUID: SC, Data: 'H4sI...', MD5List: 'x' }],
    '/raw/nft-transfer-data/': () => [
      { Function: 'Transfer()', ContractUID: SC, ToAddress: RECIPIENT, Locators: 'NA' },
    ],
    '/raw/nft-evolve-data/': () => [{ Function: 'ChangeEvolveStateSpecific()', ContractUID: SC, NewEvoState: 2 }],
    '/raw/nft-burn-data/': () => ({
      Success: true,
      Message: JSON.stringify([{ Function: 'Burn()', ContractUID: SC, FromAddress: owner.address }]),
    }),
    ...overrides,
  });
}

const sent = (calls: CapturedCall[]) =>
  calls
    .filter((c) => c.url.includes('/raw/send/'))
    .map((c) => (c.body as { transaction: Record<string, unknown> }).transaction);

function recordingSigner(address = owner.address, key = privateKey) {
  const intents: SigningIntent[] = [];
  const requests: SigningRequest[] = [];
  const signer: Signer = {
    address,
    publicKey: keypairService.publicFromPrivate(key),
    approve: (intent) => {
      intents.push(intent);
    },
    signDigest: (digestHex: string, request?: SigningRequest) => {
      requests.push(request as SigningRequest);
      return Uint8Array.from(
        curve
          .keyFromPrivate(Buffer.from(key.replace(/^00/, ''), 'hex'))
          .sign(Buffer.from(digestHex, 'hex'))
          .toDER(),
      );
    },
  };
  return { signer, intents, requests };
}

const mintParams = {
  name: 'Lighthouse',
  description: 'line one\nline two\r',
  minterName: 'Mintwood',
  asset: { url: 'https://data-testnet.verifiedx.io/media/abc/art.png', fileSize: 1234 },
};

afterEach(() => jest.restoreAllMocks());

describe('nftMintPayload', () => {
  test('matches the web wallet compiler payload', () => {
    const payload = nftMintPayload({
      ...mintParams,
      minterAddress: owner.address,
      properties: { 'Ra:rity': 'Le<|>gend' },
      royalty: { type: 'percent', amount: 0.05, payToAddress: owner.address },
      additionalAssets: [{ url: 'https://x/y/extra.mp4', fileSize: 9 }],
      evolve: {
        type: 'blockHeight',
        phases: [
          { name: 'Two', description: 'later', blockHeight: 200 },
          { name: 'One', description: 'first', blockHeight: 100 },
        ],
      },
    });
    expect(payload).toMatchObject({
      Name: 'Lighthouse',
      MinterName: 'Mintwood',
      Description: 'line one\\nline two',
      IsPublic: false,
      MinterAddress: owner.address,
      IsMinter: true,
      SCVersion: 1,
      Properties: { Rarity: 'Legend' },
      SmartContractAsset: {
        AssetId: '00000000-0000-0000-0000-000000000000',
        Name: 'art.png',
        AssetAuthorName: 'Mintwood',
        Location: mintParams.asset.url,
        Extension: 'png',
        FileSize: 1234,
      },
    });
    const features = payload.Features as Array<{ FeatureName: number; FeatureFeatures: unknown }>;
    expect(features.map((f) => f.FeatureName)).toEqual([1, 0, 2]);
    expect(features[0].FeatureFeatures).toEqual({
      RoyaltyAmount: 0.05,
      RoyaltyPayToAddress: owner.address,
      RoyaltyType: 1,
    });
    expect(
      (features[1].FeatureFeatures as Array<{ Name: string; EvolutionState: number }>).map((p) => [
        p.Name,
        p.EvolutionState,
      ]),
    ).toEqual([
      ['One', 1],
      ['Two', 2],
    ]);
    expect(features[2].FeatureFeatures).toEqual([
      expect.objectContaining({
        FileName: 'extra.mp4',
        Extension: 'mp4',
        AssetAuthorName: 'Mintwood',
        Location: 'https://x/y/extra.mp4',
      }),
    ]);
  });

  test('an NFT without media gets the default placeholder, and bad input is refused', () => {
    const payload = nftMintPayload({ name: 'n', description: 'd', minterName: 'm', minterAddress: owner.address });
    expect(payload.SmartContractAsset).toMatchObject({ Location: 'default', FileSize: 0 });
    expect(payload).not.toHaveProperty('Properties');
    expect(() => nftMintPayload({ name: '', description: 'd', minterName: 'm', minterAddress: 'x' })).toThrow(/name/);
    expect(() =>
      nftMintPayload({
        name: 'n',
        description: 'd',
        minterName: 'm',
        minterAddress: 'x',
        royalty: { type: 'percent', amount: 1.5, payToAddress: 'x' },
      }),
    ).toThrow(/royalty/);
  });
});

describe('VfxClient NFT writes', () => {
  test('mintNft compiles, then sends a Type 2 to the minter with the compiled Data, as one approved flow', async () => {
    const { calls } = installPipeline();
    const { signer, intents, requests } = recordingSigner();
    const result = await new VfxClient('testnet').mintNft(signer, mintParams);
    expect(result?.scIdentifier).toBe(SC);
    const compile = calls.find((c) => c.url.includes('/raw/smart-contract-data/'));
    expect(compile?.body).toMatchObject({ Name: 'Lighthouse', MinterAddress: owner.address, SCVersion: 1 });
    const [tx] = sent(calls);
    expect(tx).toMatchObject({ TransactionType: TxType.NftMint, ToAddress: owner.address, Amount: 0 });
    expect(tx.Data).toEqual([{ Function: 'Mint()', ContractUID: SC, Data: 'H4sI...', MD5List: 'x' }]);
    expect(intents).toEqual([expect.objectContaining({ action: 'nft-mint', names: ['Lighthouse'] })]);
    expect(requests.map((r) => r.flowId)).toEqual([intents[0].flowId]);
  });

  test('mintNfts approves once, mints in order, and reports what was minted when one fails', async () => {
    let compiles = 0;
    const { calls } = installPipeline({
      '/raw/smart-contract-data/': () => {
        compiles += 1;
        if (compiles === 3) throw new Error('compile failed');
        return [{ Function: 'Mint()', ContractUID: `sc-${compiles}`, Data: 'x', MD5List: 'x' }];
      },
    });
    const { signer, intents } = recordingSigner();
    const items = [1, 2, 3].map((n) => ({ ...mintParams, name: `Item ${n}` }));
    const error = await new VfxClient('testnet').mintNfts(signer, items).catch((e) => e);
    expect(error).toBeInstanceOf(NftBulkMintError);
    expect(error.index).toBe(2);
    expect(error.minted.map((m: { scIdentifier: string }) => m.scIdentifier)).toEqual(['sc-1', 'sc-2']);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ action: 'nft-mint', names: ['Item 1', 'Item 2', 'Item 3'] });
    expect(sent(calls)).toHaveLength(2);
  });

  test('transferNft skips the beacon for an NFT without media and sends a Type 3 to the recipient', async () => {
    const { calls } = installPipeline({
      [`/nft/${encodeURIComponent(SC)}/`]: () => ({
        identifier: SC,
        owner_address: owner.address,
        primary_asset_name: 'default',
        primary_asset_size: 0,
        // Spyglass sends the contract as JSON text, as the testnet node reports it.
        smart_contract_data: JSON.stringify({
          SmartContractMain: {
            SmartContractAsset: { Name: 'default', Location: 'Asset Folder', FileSize: 0 },
            Features: [],
          },
        }),
      }),
    });
    const { signer, intents, requests } = recordingSigner();
    await new VfxClient('testnet').transferNft(signer, { scIdentifier: SC, toAddress: RECIPIENT });
    expect(calls.some((c) => c.url.includes('/beacon/upload/'))).toBe(false);
    expect(calls.find((c) => c.url.includes('/raw/nft-transfer-data/'))?.url).toContain(`/${RECIPIENT}/NA/`);
    const [tx] = sent(calls);
    expect(tx).toMatchObject({ TransactionType: TxType.NftTx, ToAddress: RECIPIENT, UnlockTime: null });
    expect(intents[0]).toMatchObject({ action: 'nft-transfer', toAddress: RECIPIENT, unlockHours: null });
    expect(requests.map((r) => r.kind)).toEqual(['transaction']);
  });

  test('transferNft with media asks the node to push it to a beacon, signed over the contract id', async () => {
    const { calls } = installPipeline({
      [`/nft/${encodeURIComponent(SC)}/`]: () => ({
        identifier: SC,
        owner_address: owner.address,
        primary_asset_name: 'art.png',
        primary_asset_size: 1234,
        smart_contract_data: JSON.stringify({
          SmartContractMain: { SmartContractAsset: { Name: 'art.png', Location: 'Asset Folder', FileSize: 1234 } },
        }),
      }),
      '/raw/beacon/upload/': () => ({ success: true, locator: 'BEACON_LOC' }),
    });
    const { signer, requests } = recordingSigner();
    await new VfxClient('testnet').transferNft(signer, { scIdentifier: SC, toAddress: RECIPIENT });
    expect(requests[0]).toMatchObject({ kind: 'nft-beacon-upload', message: SC, toAddress: RECIPIENT });
    const beacon = calls.find((c) => c.url.includes('/raw/beacon/upload/'));
    const signature = decodeURIComponent((beacon?.url as string).split('/').slice(-2)[0]);
    expect(keypairService.verifySignature(SC, signature, owner.address)).toBe(true);
    expect(calls.find((c) => c.url.includes('/raw/nft-transfer-data/'))?.url).toContain('/BEACON_LOC/');
  });

  test('transferNft refuses an NFT the signer does not own, before signing anything', async () => {
    installPipeline({
      [`/nft/`]: () => ({ identifier: SC, owner_address: 'xSomeoneElse', smart_contract_data: null }),
    });
    const { signer, requests } = recordingSigner();
    await expect(
      new VfxClient('testnet').transferNft(signer, { scIdentifier: SC, toAddress: RECIPIENT }),
    ).rejects.toThrow(/is owned by xSomeoneElse/);
    expect(requests).toHaveLength(0);
  });

  test('a transfer from a vault waits behind its unlock time', async () => {
    const { calls } = installPipeline();
    const now = Math.round(Date.now() / 1000);
    await new VfxClient('testnet').transferNft(vault, {
      scIdentifier: SC,
      toAddress: RECIPIENT,
      locator: 'NA',
      unlockHours: 48,
    });
    const [tx] = sent(calls);
    expect(tx.FromAddress).toBe(vault.address);
    expect(tx.UnlockTime as number).toBeGreaterThanOrEqual(now + 48 * 3600);
    // Under 24 hours is raised to the minimum.
    const short = installPipeline();
    await new VfxClient('testnet').transferNft(vault, {
      scIdentifier: SC,
      toAddress: RECIPIENT,
      locator: 'NA',
      unlockHours: 2,
    });
    expect(sent(short.calls)[0].UnlockTime as number).toBeGreaterThanOrEqual(now + 24 * 3600);
  });

  test('evolveNft sends the stage change to the owner; burnNft sends a Type 4 to the owner', async () => {
    const { calls } = installPipeline();
    const client = new VfxClient('testnet');
    await client.evolveNft(owner, { scIdentifier: SC, stage: 2, ownerAddress: RECIPIENT });
    expect(calls.find((c) => c.url.includes('/raw/nft-evolve-data/'))?.url).toContain(`/${RECIPIENT}/2/`);
    await client.burnNft(owner, { scIdentifier: SC });
    const [evolve, burn] = sent(calls);
    expect(evolve).toMatchObject({ TransactionType: TxType.NftTx, ToAddress: RECIPIENT });
    expect(burn).toMatchObject({ TransactionType: TxType.NftBurn, ToAddress: owner.address });
    expect(burn.Data).toEqual([{ Function: 'Burn()', ContractUID: SC, FromAddress: owner.address }]);
    await expect(client.evolveNft(owner, { scIdentifier: SC, stage: 1.5, ownerAddress: RECIPIENT })).rejects.toThrow(
      /whole number/,
    );
  });

  test('a declined approval sends nothing', async () => {
    const { calls } = installPipeline();
    const declining: Signer = {
      ...recordingSigner().signer,
      approve: () => {
        throw new Error('declined');
      },
    };
    const client = new VfxClient('testnet');
    await expect(client.mintNft(declining, mintParams)).rejects.toThrow('declined');
    await expect(client.burnNft(declining, { scIdentifier: SC })).rejects.toThrow('declined');
    expect(calls).toHaveLength(0);
  });
});

describe('ownership proofs and reads', () => {
  test('proveNftOwnership produces the wallet format, which verifyNftOwnership hands to Spyglass', async () => {
    const { calls } = installFetch({ '/nft/verify-ownership/': () => ({ verified: true }) });
    const client = new VfxClient('testnet');
    const proof = await client.proveNftOwnership(owner, SC);
    const [address, message, signature, scId] = proof.split('<>');
    expect(address).toBe(owner.address);
    expect(scId).toBe(SC);
    expect(message).toMatch(/^[A-Za-z]{8}\.\d+$/);
    expect(keypairService.verifySignature(message, signature, owner.address)).toBe(true);
    expect(await client.verifyNftOwnership(proof)).toBe(true);
    expect(calls[0].body).toEqual({ signature: proof });
    await expect(client.verifyNftOwnership('nope')).rejects.toThrow(/expected/);
  });

  test('list, multi-address list, detail and media association hit the Spyglass routes', async () => {
    const { calls } = installFetch({
      '/nft/addresses/': () => ({ count: 0, page: 1, num_pages: 1, results: [] }),
      '/nft/?': () => ({ count: 0, page: 1, num_pages: 1, results: [] }),
      '/auth/sign-token/': () => ({ token: 'TOKEN', expires_at: 'later' }),
      '/media/associate-media/': () => ({ success: true }),
      [`/nft/${encodeURIComponent(SC)}/`]: () => ({ identifier: SC }),
    });
    const client = new VfxClient('testnet');
    await client.listNfts({ ownerAddress: owner.address, page: 2 });
    await client.listNftsForAddresses([owner.address, vault.address]);
    await client.getNft(SC);
    await client.associateNftMedia(owner, { scIdentifier: SC, mediaMap: { 'art.png': 'https://m/art.png' } });
    expect(calls[0].url).toContain(`/nft/?owner_address=${owner.address}&page=2`);
    expect(calls[1].url).toContain(`/nft/addresses/${owner.address},${vault.address}/`);
    const token = calls.find((c) => c.url.includes('/auth/sign-token/'));
    const body = token?.body as { address: string; message: string; signature: string };
    expect(keypairService.verifySignature(body.message, body.signature, owner.address)).toBe(true);
    const associate = global.fetch as jest.Mock;
    const init = associate.mock.calls.find((c) => String(c[0]).includes('/associate-media/'))?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('basic TOKEN');
    expect(JSON.parse(init.body as string)).toEqual({ media_map: { 'art.png': 'https://m/art.png' } });
  });
});

describe('reading the contract Spyglass reports', () => {
  // Trimmed from a testnet NFT minted by the integration test (2026-11-09).
  const live = {
    primary_asset_name: 'default',
    primary_asset_size: 0,
    smart_contract_data: JSON.stringify({
      SmartContractMain: {
        SmartContractAsset: { Name: 'default', Location: 'Asset Folder', FileSize: 0 },
        Features: [
          {
            FeatureName: 0,
            FeatureFeatures: [
              { EvolutionState: 1, Name: 'Stage one', Description: 'first', IsCurrentState: false },
              { EvolutionState: 2, Name: 'Stage two', Description: 'second', IsCurrentState: true },
            ],
          },
        ],
      },
      CurrentOwner: 'xMjrfrzkrNC2g3KJidbwF21gB7R3m46B9w',
    }),
  };

  test('stages, the current stage and media-less detection', () => {
    expect(nftEvolveStages(live).map((stage) => stage.Name)).toEqual(['Stage one', 'Stage two']);
    expect(nftCurrentStage(live)).toBe(2);
    expect(nftIsMedialess(live)).toBe(true);
    expect(
      nftIsMedialess({ ...live, smart_contract_data: null, primary_asset_name: 'art.png', primary_asset_size: 5 }),
    ).toBe(false);
    expect(nftContract({ smart_contract_data: 'not json' })).toBeNull();
  });
});

describe('Greptile review fixes', () => {
  test('an NFT whose only media sits on an evolve stage is not media-less', () => {
    const withStageMedia = {
      primary_asset_name: 'default',
      primary_asset_size: 0,
      smart_contract_data: JSON.stringify({
        SmartContractMain: {
          SmartContractAsset: { Name: 'default', FileSize: 0 },
          Features: [
            {
              FeatureName: 0,
              FeatureFeatures: [
                { EvolutionState: 1, Name: 'a', Description: 'a', IsCurrentState: false, SmartContractAsset: null },
                {
                  EvolutionState: 2,
                  Name: 'b',
                  Description: 'b',
                  IsCurrentState: false,
                  SmartContractAsset: { Name: 'night.png', FileSize: 900 },
                },
              ],
            },
          ],
        },
      }),
    };
    expect(nftIsMedialess(withStageMedia)).toBe(false);
  });

  test('a dry-run transfer of an NFT with media never requests a beacon upload', async () => {
    const { calls } = installPipeline({
      [`/nft/${encodeURIComponent(SC)}/`]: () => ({
        identifier: SC,
        owner_address: owner.address,
        primary_asset_name: 'art.png',
        primary_asset_size: 1234,
        smart_contract_data: JSON.stringify({
          SmartContractMain: { SmartContractAsset: { Name: 'art.png', FileSize: 1234 } },
        }),
      }),
      '/raw/beacon/upload/': () => ({ success: true, locator: 'BEACON_LOC' }),
    });
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(client.transferNft(owner, { scIdentifier: SC, toAddress: RECIPIENT })).rejects.toThrow(
      /needs a `locator`/,
    );
    expect(calls.some((c) => c.url.includes('/beacon/upload/'))).toBe(false);
    // With a locator a dry run builds and verifies, sending nothing.
    await client.transferNft(owner, { scIdentifier: SC, toAddress: RECIPIENT, locator: 'BEACON_LOC' });
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });
});
