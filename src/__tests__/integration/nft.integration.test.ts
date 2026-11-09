import dotenv from 'dotenv';
import { VfxClient } from '../../index';
import { Network } from '../../constants';
import { nftCurrentStage, nftEvolveRefusal, nftEvolveStages, nftIsMedialess } from '../../client/nft-api-client';
import { encryptVfxShh, formatVfxShhMessage } from '../../services/vfx-shh';

dotenv.config({ path: 'test.env' });

/**
 * Live-testnet NFT lifecycle. Opt-in only:
 *
 *   RUN_NFT_LIFECYCLE=1 npm run test:integration -- -t "NFT lifecycle"
 *
 *   PRIVATE_KEY   funded testnet key: mints, evolves, transfers, and funds
 *                 a fresh account that burns.
 *
 * mint (two manual evolve stages, no media) -> evolve to stage 2 -> transfer
 * to a fresh account -> that account burns it. Each step waits for the
 * chain and Spyglass to show the previous one. First passed 2026-11-09 on
 * testnet blocks 116781 (mint), 116784 (evolve), 116788 (transfer) and
 * 116791 (burn), NFT c58ef52feba54b0cbd9b527809dc2863:1794184964.
 */

jest.setTimeout(15 * 60_000);

const privateKey = process.env.PRIVATE_KEY;
const run = privateKey && process.env.RUN_NFT_LIFECYCLE === '1';

async function waitFor<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5 * 60_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (done(value)) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`timed out waiting for ${label}: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

(run ? describe : describe.skip)('NFT lifecycle on testnet', () => {
  const client = new VfxClient(Network.Testnet);
  // Built in the test, not while Jest collects it, so a run without
  // PRIVATE_KEY skips cleanly.
  const account = (key: string) => ({
    privateKey: key,
    publicKey: client.publicFromPrivate(key),
    address: client.addressFromPrivate(key),
  });

  test('mint -> evolve -> transfer -> burn', async () => {
    const minter = account(privateKey as string);
    const holder = account(client.generatePrivateKey());
    const minted = await client.mintNft(minter, {
      name: `SDK lifecycle ${Date.now()}`,
      description: 'vfx-web-sdk integration test\nsecond line',
      minterName: 'vfx-web-sdk',
      properties: { run: String(Date.now()) },
      evolve: {
        type: 'manual',
        phases: [
          { name: 'Stage one', description: 'first' },
          { name: 'Stage two', description: 'second' },
        ],
      },
    });
    expect(minted?.transactionHash).toMatch(/^[0-9a-f]{64}$/);
    const scIdentifier = minted?.scIdentifier as string;

    await waitFor(
      'the mint on Spyglass',
      () => client.getNft(scIdentifier),
      (nft) => nft.owner_address === minter.address,
    );
    expect(nftIsMedialess(await client.getNft(scIdentifier))).toBe(true);
    const ownProof = await client.proveNftOwnership(minter, scIdentifier);
    expect(await client.verifyNftOwnership(ownProof)).toBe(true);

    const evolved = await client.evolveNft(minter, { scIdentifier, stage: 2, ownerAddress: minter.address });
    expect(evolved).toMatch(/^[0-9a-f]{64}$/);
    await waitFor(
      'stage 2',
      () => client.getNft(scIdentifier),
      (nft) => nftCurrentStage(nft) === 2,
    );

    await client.sendCoin(minter, holder.address, 0.01);
    const transferred = await client.transferNft(minter, { scIdentifier, toAddress: holder.address });
    expect(transferred).toMatch(/^[0-9a-f]{64}$/);
    await waitFor(
      'the transfer',
      () => client.getNft(scIdentifier),
      (nft) => nft.owner_address === holder.address,
    );
    const listed = await client.listNfts({ ownerAddress: holder.address });
    expect(listed.results.map((n) => n.identifier)).toContain(scIdentifier);

    const burned = await client.burnNft(holder, { scIdentifier });
    expect(burned).toMatch(/^[0-9a-f]{64}$/);
    // Spyglass stops serving a burned NFT's detail (404); its history keeps
    // the whole lifecycle.
    const history = (await waitFor(
      'the burn in the NFT history',
      () => client.getNftHistory(scIdentifier) as Promise<{ results: Array<{ data: string; height: number }> }>,
      (page) => page.results.some((tx) => tx.data.includes('Burn()')),
    )) as { results: Array<{ data: string; height: number }> };
    const functions = history.results.sort((a, b) => a.height - b.height).map((tx) => JSON.parse(tx.data)[0].Function);
    expect(functions).toEqual(['Mint()', 'ChangeEvolveStateSpecific()', 'Transfer()', 'Burn()']);
  });

  test('time evolve + VFX-SHH message: the chain keeps the dates, the recipient reads the message', async () => {
    const minter = account(privateKey as string);
    const reader = account(client.generatePrivateKey());
    const secret = `gm from the SDK ${Date.now()}`;
    const sealed = formatVfxShhMessage(reader.address, await encryptVfxShh(reader.publicKey, secret));
    const later = new Date(Date.now() + 7 * 24 * 3600_000);
    const muchLater = new Date(Date.now() + 14 * 24 * 3600_000);
    const minted = await client.mintNft(minter, {
      name: `SDK time evolve ${Date.now()}`,
      description: `A sealed note\n${sealed}`,
      minterName: 'vfx-web-sdk',
      evolve: {
        type: 'time',
        phases: [
          { name: 'Week one', description: 'one', evolveDate: later },
          { name: 'Week two', description: 'two', evolveDate: muchLater },
        ],
      },
    });
    const scIdentifier = minted?.scIdentifier as string;
    const nft = await waitFor(
      'the mint on Spyglass',
      () => client.getNft(scIdentifier),
      (n) => n.owner_address === minter.address,
    );
    const stages = nftEvolveStages(nft);
    expect(stages.map((stage) => [stage.EvolutionState, Date.parse(String(stage.EvolveDate))])).toEqual([
      [1, later.getTime()],
      [2, muchLater.getTime()],
    ]);
    expect(nftEvolveRefusal(nft, minter.address, 2)).toBeNull();
    expect(nftEvolveRefusal(nft, reader.address, 1)).toMatch(/Only the minter/);
    expect(await client.decryptNftMessage(reader, nft)).toEqual({ recipientAddress: reader.address, message: secret });
    await expect(client.decryptNftMessage(minter, nft)).rejects.toThrow(/for /);
    expect(await client.pullNftBeaconAssets(minter, scIdentifier)).toEqual({ locators: 'NA', pulled: false });
  });
});
