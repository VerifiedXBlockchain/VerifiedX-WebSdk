import dotenv from 'dotenv';
import { VfxClient } from '../../index';
import { Network } from '../../constants';
import { Keypair } from '../../types';

dotenv.config({ path: 'test.env' });

/**
 * Live-testnet checks for fungible tokens. Opt-in only:
 *
 *   npm run test:integration
 *
 * Shape checks run unconditionally. Anything that needs on-chain state reads
 * fixtures from test.env / the environment and skips when they are absent:
 *
 *   PRIVATE_KEY          funded testnet key (also used by the other suites)
 *   TOKEN_SC_IDENTIFIER  a token this key owns, mintable and burnable
 *   RUN_TOKEN_LIFECYCLE  =1 to actually broadcast: mint → transfer → burn.
 *                        Without it the state-dependent tests run in dryRun,
 *                        which drives the live pipeline through fee, hash,
 *                        signature validation and node-side verify but stops
 *                        before the send.
 */

jest.setTimeout(60_000);

describe('fungible token reads (testnet)', () => {
  const client = new VfxClient(Network.Testnet, true);

  test('listFungibleTokens returns a paginated shape', async () => {
    const page = await client.listFungibleTokens(1, 5);
    expect(typeof page.count).toBe('number');
    expect(Array.isArray(page.results)).toBe(true);
    for (const token of page.results) {
      expect(typeof token.sc_identifier).toBe('string');
      expect(typeof token.is_paused).toBe('boolean');
      expect(Array.isArray(token.banned_addresses)).toBe(true);
    }
  });

  test('getFungibleTokenBalances reads a fresh address as empty', async () => {
    const address = client.addressFromPrivate(client.generatePrivateKey());
    expect(await client.getFungibleTokenBalances(address)).toEqual([]);
  });
});

const privateKey = process.env.PRIVATE_KEY;
const scIdentifier = process.env.TOKEN_SC_IDENTIFIER;
const broadcast = process.env.RUN_TOKEN_LIFECYCLE === '1';

(privateKey && scIdentifier ? describe : describe.skip)('token lifecycle (PRIVATE_KEY + TOKEN_SC_IDENTIFIER)', () => {
  const client = new VfxClient(Network.Testnet, !broadcast);
  const sc = scIdentifier as string;
  // Derived in beforeAll: a skipped describe still runs its body, and there is
  // no key to derive from when the suite is skipped.
  let keypair: Keypair;

  beforeAll(() => {
    keypair = {
      privateKey: privateKey as string,
      publicKey: client.publicFromPrivate(privateKey as string),
      address: client.addressFromPrivate(privateKey as string),
    };
  });

  test('the fixture token is owned by the key and allows mint and burn', async () => {
    const detail = await client.getFungibleToken(sc);
    expect(detail.token.owner_address).toBe(keypair.address);
    expect(detail.token.can_mint).toBe(true);
    expect(detail.token.can_burn).toBe(true);
  });

  test(`mint → transfer → burn ${broadcast ? '(broadcast)' : '(dryRun: verified by the node, not sent)'}`, async () => {
    const recipient = client.addressFromPrivate(client.generatePrivateKey());

    const mintHash = await client.mintToken(keypair, { scIdentifier: sc, amount: 3 });
    expect(typeof mintHash).toBe('string');

    const transferHash = await client.transferToken(keypair, { scIdentifier: sc, toAddress: recipient, amount: 1 });
    expect(typeof transferHash).toBe('string');

    const burnHash = await client.burnToken(keypair, { scIdentifier: sc, amount: 1 });
    expect(typeof burnHash).toBe('string');
  });

  test('deployToken compiles a fresh contract on the node (dryRun unless RUN_TOKEN_LIFECYCLE=1)', async () => {
    const deployed = await client.deployToken(keypair, {
      name: `SDK Test ${Date.now()}`,
      ticker: 'SDKT',
      mintable: true,
      burnable: true,
    });
    expect(deployed).not.toBeNull();
    expect(typeof deployed?.scIdentifier).toBe('string');
    expect(typeof deployed?.transactionHash).toBe('string');
  });
});
