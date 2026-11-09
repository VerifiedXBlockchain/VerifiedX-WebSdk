import { VfxClient, isBlockAddressesEvent, blockAddressesTouching } from '../index';
import { installFetch } from './helpers/mock-fetch';

const A = 'xMjrfrzkrNC2g3KJidbwF21gB7R3m46B9w';
const VAULT = 'xRBX5yX19sgbzJrx19pWY37NDjpnZ99c2Q';
const notFound = () => new Response('{"detail":"Not found."}', { status: 404 });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

afterEach(() => jest.restoreAllMocks());

describe('vBTC V2 reads with view=wallet', () => {
  const token = {
    sc_identifier: 'sc-1',
    nft: { identifier: 'sc-1', name: 'n', minted_at: 't', mint_transaction: null },
  };

  test('the default requests are unchanged: no view parameter', async () => {
    const { calls } = installFetch({
      '/btc/vbtc-v2/detail/': () => token,
      '/btc/vbtc-v2/': () => ({ results: [token] }),
    });
    const client = new VfxClient('testnet');
    await client.getVbtcTokens(A);
    await client.getVbtcTokenDetail('sc-1');
    await client.listVbtcTokens();
    expect(calls.map((c) => new URL(c.url).search)).toEqual(['', '', '']);
  });

  test("view: 'wallet' is sent on the address list, the detail and the full list", async () => {
    const { calls } = installFetch({
      '/btc/vbtc-v2/detail/': () => token,
      '/btc/vbtc-v2/': () => ({ results: [token] }),
    });
    const client = new VfxClient('testnet');
    expect(await client.getVbtcTokens(A, { view: 'wallet' })).toEqual([token]);
    expect(await client.getVbtcTokenDetail('sc-1', { view: 'wallet' })).toEqual(token);
    await client.listVbtcTokens({ view: 'wallet' });
    expect(calls.map((c) => [new URL(c.url).pathname.split('/api')[1], params(c.url)])).toEqual([
      [`/btc/vbtc-v2/${A}/`, { view: 'wallet' }],
      ['/btc/vbtc-v2/detail/sc-1/', { view: 'wallet' }],
      ['/btc/vbtc-v2/', { view: 'wallet' }],
    ]);
  });

  test('listVbtcTokensPage pages in the wallet view; an older Spyglass list comes back as one page', async () => {
    const page = { count: 32, page: 2, num_pages: 4, results: [token] };
    const { calls } = installFetch({ '/btc/vbtc-v2/': () => page });
    expect(await new VfxClient('testnet').listVbtcTokensPage({ page: 2, limit: 8 })).toEqual(page);
    expect(params(calls[0].url)).toEqual({ view: 'wallet', page: '2', limit: '8' });

    installFetch({ '/btc/vbtc-v2/': () => ({ results: [token, token] }) });
    expect(await new VfxClient('testnet').listVbtcTokensPage({ page: 2 })).toEqual({
      count: 2,
      page: 1,
      num_pages: 1,
      results: [token, token],
    });
  });
});

describe('listAddressActivity (cursor)', () => {
  const row = { hash: 'h1', height: 10 };

  test('sends the addresses, limit and cursor, and returns the next cursor', async () => {
    const { calls } = installFetch({
      '/transaction/activity/': () => ({ results: [row], next_cursor: '10:h1' }),
    });
    const page = await new VfxClient('testnet').listAddressActivity([A, VAULT, A], { limit: 1, before: '12:ff' });
    expect(page).toEqual({ results: [row], nextCursor: '10:h1' });
    expect(params(calls[0].url)).toEqual({ addresses: `${A},${VAULT}`, limit: '1', before: '12:ff' });
  });

  test('the last page has a null cursor; an older Spyglass resolves to null', async () => {
    installFetch({ '/transaction/activity/': () => ({ results: [], next_cursor: null }) });
    expect(await new VfxClient('testnet').listAddressActivity([A])).toEqual({ results: [], nextCursor: null });
    installFetch({ '/transaction/activity/': notFound });
    expect(await new VfxClient('testnet').listAddressActivity([A])).toBeNull();
  });

  test('bad arguments are refused before any request; a server error throws', async () => {
    const { calls } = installFetch({ '/transaction/activity/': () => new Response('down', { status: 502 }) });
    const client = new VfxClient('testnet');
    await expect(client.listAddressActivity([])).rejects.toThrow(/1 to 20 addresses/);
    await expect(client.listAddressActivity(Array.from({ length: 21 }, (_, i) => `x${i}`))).rejects.toThrow(
      /1 to 20 addresses/,
    );
    await expect(client.listAddressActivity([A], { limit: 101 })).rejects.toThrow(/limit/);
    await expect(client.listAddressActivity([A], { before: 'h1' })).rejects.toThrow(/cursor/);
    expect(calls).toHaveLength(0);
    await expect(client.listAddressActivity([A])).rejects.toMatchObject({ name: 'VfxApiError', status: 502 });
  });
});

describe('addressHasActivity', () => {
  test('maps rows to the request order, duplicates removed', async () => {
    const { calls } = installFetch({
      '/addresses/activity/': () => ({
        results: [
          {
            address: VAULT,
            has_transactions: true,
            has_balance: true,
            vault_activated: true,
            register_recovery_addresses: ['xRecovery'],
          },
          {
            address: A,
            has_transactions: true,
            has_balance: false,
            vault_activated: false,
            register_recovery_addresses: [],
          },
        ],
      }),
    });
    expect(await new VfxClient('testnet').addressHasActivity([A, VAULT, A])).toEqual([
      { address: A, hasTransactions: true, hasBalance: false, vaultActivated: false, registerRecoveryAddresses: [] },
      {
        address: VAULT,
        hasTransactions: true,
        hasBalance: true,
        vaultActivated: true,
        registerRecoveryAddresses: ['xRecovery'],
      },
    ]);
    expect(params(calls[0].url)).toEqual({ addresses: `${A},${VAULT}` });
  });

  test('null on an older Spyglass; a missing row or a server error throws', async () => {
    installFetch({ '/addresses/activity/': notFound });
    expect(await new VfxClient('testnet').addressHasActivity([A])).toBeNull();
    installFetch({ '/addresses/activity/': () => ({ results: [] }) });
    await expect(new VfxClient('testnet').addressHasActivity([A])).rejects.toThrow(/no row for/);
    installFetch({ '/addresses/activity/': () => new Response('down', { status: 500 }) });
    await expect(new VfxClient('testnet').addressHasActivity([A])).rejects.toMatchObject({ status: 500 });
  });
});

describe('names: availability and a lean lookup', () => {
  test('domainAvailability reads the availability route; null on an older Spyglass', async () => {
    const { calls } = installFetch({
      '/adnr/available/': () => ({ domain: 'free.vfx', available: true, indexed_height: 118531 }),
    });
    expect(await new VfxClient('testnet').domainAvailability('Free')).toEqual({
      domain: 'free.vfx',
      available: true,
      indexedHeight: 118531,
    });
    expect(new URL(calls[0].url).pathname).toMatch(/\/adnr\/available\/free\.vfx\/$/);
    installFetch({ '/adnr/available/': notFound });
    expect(await new VfxClient('testnet').domainAvailability('free.vfx')).toBeNull();
  });

  test('only available: true means free', async () => {
    installFetch({ '/adnr/available/': () => ({ domain: 'taken.vfx', available: 'yes', indexed_height: 1 }) });
    expect((await new VfxClient('testnet').domainAvailability('taken.vfx'))?.available).toBe(false);
  });

  test('lookupDomain lean asks for the address only; the default request is unchanged', async () => {
    const { calls } = installFetch({
      '/addresses/adnr/': () => ({ address: A, balance: 1 }),
      '/adnr/': () => ({ address: A, domain: 'name.vfx' }),
    });
    const client = new VfxClient('testnet');
    expect(await client.lookupDomain('name.vfx')).toBe(A);
    expect(await client.lookupDomain('name.vfx', { lean: true })).toBe(A);
    expect(calls.map((c) => [new URL(c.url).pathname.split('/api')[1], params(c.url)])).toEqual([
      ['/addresses/adnr/name.vfx/', {}],
      ['/adnr/name.vfx/', { fields: 'address' }],
    ]);
  });

  test('lean: an unknown name is null; other failures throw only when strict', async () => {
    installFetch({ '/adnr/': notFound });
    expect(await new VfxClient('testnet').lookupDomain('gone.vfx', { lean: true, strict: true })).toBeNull();
    installFetch({ '/adnr/': () => new Response('down', { status: 503 }) });
    expect(await new VfxClient('testnet').lookupDomain('x.vfx', { lean: true })).toBeNull();
    await expect(new VfxClient('testnet').lookupDomain('x.vfx', { lean: true, strict: true })).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('the block_addresses socket event', () => {
  const event = {
    type: 'block_addresses',
    data: { height: 118600, hash: 'bh', affected_addresses: [A, 'xOther'] },
    message: 'block 118600 addresses',
  };

  test('recognised as an object or as JSON text; new_block and junk are not', () => {
    expect(isBlockAddressesEvent(event)).toBe(true);
    expect(isBlockAddressesEvent(JSON.stringify(event))).toBe(true);
    expect(isBlockAddressesEvent({ type: 'new_block', data: { height: 1 }, message: '' })).toBe(false);
    expect(isBlockAddressesEvent({ type: 'block_addresses', data: { height: 1, hash: 'h' } })).toBe(false);
    expect(isBlockAddressesEvent('not json')).toBe(false);
    expect(isBlockAddressesEvent(null)).toBe(false);
  });

  test('blockAddressesTouching picks the wallet addresses the block listed', () => {
    if (!isBlockAddressesEvent(event)) throw new Error('fixture is not an event');
    expect(blockAddressesTouching(event, [VAULT, A])).toEqual([A]);
  });
});
